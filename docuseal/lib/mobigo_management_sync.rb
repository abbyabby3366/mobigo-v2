# frozen_string_literal: true

require 'net/http'
require 'json'

module MobigoManagementSync
  module_function

  def is_phone_rental_template?(submitter, doc_name)
    name_str = doc_name.to_s.strip.downcase
    name_str.include?('phone rental') || name_str.include?('phone-rental')
  end

  def read_env_value(key_name)
    val = ENV[key_name].presence
    return val if val.present?

    # Prioritize root directory .env (mobigo-v2/.env)
    env_files = [
      File.expand_path('../../../.env', __dir__),
      (Rails.root.join('../.env') rescue nil),
      File.expand_path('../../.env', __dir__),
      (Rails.root.join('.env') rescue nil)
    ].compact.uniq

    env_files.each do |path|
      next unless File.exist?(path)

      File.foreach(path) do |line|
        trimmed = line.strip
        next if trimmed.start_with?('#') || !trimmed.include?('=')

        k, v = trimmed.split('=', 2)
        if k.strip == key_name
          clean_v = v.to_s.strip.gsub(/^['"]|['"]$/, '')
          return clean_v if clean_v.present?
        end
      end
    end

    nil
  end

  def call(submitter)
    doc_name = submitter.submission&.template&.name.presence ||
               submitter.submission&.name.presence ||
               submitter.template&.name.presence ||
               'Document Agreement'

    # Filter: Only process and notify for Phone Rental templates
    unless is_phone_rental_template?(submitter, doc_name)
      Rails.logger.info("[MobigoSync] Skipping non-phone-rental document '#{doc_name}' (Submission ##{submitter.submission_id})")
      return false
    end

    # Extract branch name from values, variables, or submission title
    raw_sub_values = submitter.values.is_a?(Hash) ? submitter.values : {}
    branch_name = raw_sub_values['branch_name'].presence ||
                  raw_sub_values['Branch Name'].presence ||
                  raw_sub_values['cawangan'].presence ||
                  raw_sub_values['branch'].presence ||
                  (submitter.submission&.variables.is_a?(Hash) && submitter.submission.variables['branch_name'].presence) ||
                  (submitter.submission&.name.to_s =~ /\(([^)]+)\)$/ ? Regexp.last_match(1).to_s.strip.presence : nil)

    api_url = read_env_value('MOBIGO_MANAGEMENT_API_URL').presence || 'https://mobigomanagement.onrender.com'
    api_key = read_env_value('MOBIGO_MANAGEMENT_API_KEY').presence || 'mbg_live_19e8ff22ff54e4a7996b5f87c0b7e2e3e07c8a2285cea05d'

    endpoint = "#{api_url.chomp('/')}/api/v1/applications"

    # Ensure generated signed contract PDF and audit trail exist before serializing
    begin
      if submitter.respond_to?(:documents) && submitter.documents.blank? && submitter.completed_at?
        Submissions::EnsureResultGenerated.call(submitter)
      end
      if submitter.submission&.completed_at? && submitter.submission&.audit_trail&.blank?
        Submissions::EnsureAuditGenerated.call(submitter.submission)
      end
    rescue StandardError => e
      Rails.logger.warn("[MobigoSync] Document ensure warning: #{e.message}")
    end

    serialized_data = Submitters::SerializeForWebhook.call(submitter)

    if branch_name.present?
      serialized_data['branch_name'] = branch_name

      # Ensure it is present in values array if not already present
      if serialized_data['values'].is_a?(Array)
        has_branch_field = serialized_data['values'].any? do |v|
          v.is_a?(Hash) && ['Branch Name', 'branch_name', 'Branch', 'Cawangan', 'cawangan'].include?(v['field'])
        end
        serialized_data['values'] << { 'field' => 'Branch Name', 'value' => branch_name } unless has_branch_field
      end
    end

    # Build flat dictionary of all raw form fields
    raw_fields = {}
    if serialized_data['values'].is_a?(Array)
      serialized_data['values'].each do |item|
        next unless item.is_a?(Hash)
        k = item['field'] || item['name']
        raw_fields[k] = item['value'] if k.present?
      end
    end

    # Standardized normalized structure
    standardized_payload = build_standardized_payload(submitter, serialized_data, raw_fields, branch_name, doc_name)

    payload = {
      'event_type' => 'submission.completed',
      'timestamp' => Time.current.iso8601
    }.merge(standardized_payload).merge('data' => serialized_data)

    mobigo_status = ''
    app_number = nil

    begin
      uri = URI(endpoint)
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = (uri.scheme == 'https')
      http.open_timeout = 8
      http.read_timeout = 15

      req = Net::HTTP::Post.new(uri.path.presence || '/', {
        'Content-Type' => 'application/json',
        'Authorization' => "Bearer #{api_key}"
      })
      req.body = payload.to_json

      res = http.request(req)
      res_json = (JSON.parse(res.body) rescue {})

      if res.code.to_i.between?(200, 299) && res_json['success']
        app_number = res_json.dig('data', 'applicationNumber') || 'Registered'
        mobigo_status = "✅ *MobiGo Management:* Recorded as #{app_number} (#{api_url})"
        Rails.logger.info("[MobigoSync] Synced completed submission #{submitter.submission_id}: #{app_number} (Branch: #{branch_name || 'N/A'})")
      else
        err_msg = res_json['message'] || res_json['error'] || res.body
        mobigo_status = "⚠️ *MobiGo Management Status:* Error (#{res.code}) - #{err_msg}"
        Rails.logger.warn("[MobigoSync] Sync error for submission #{submitter.submission_id}: #{err_msg}")
      end
    rescue StandardError => e
      mobigo_status = "⚠️ *MobiGo Management Status:* Connection failed to #{api_url} - #{e.message}"
      Rails.logger.warn("[MobigoSync] Connection error to #{api_url}: #{e.message}")
    end

    # Send WhatsApp notification via https://deswa.io7.my/api/external/send-message
    cust_name = submitter.name || 'Customer'

    whatsapp_lines = [
      "🎉 *Phone Rental Agreement Signed & Completed!*",
      "━━━━━━━━━━━━━━━━━━━━━━━",
      "📄 *Document:* #{doc_name}",
      "👤 *Customer:* #{cust_name}",
      (branch_name.present? ? "🏢 *Branch:* #{branch_name}" : nil),
      "🆔 *Submission ID:* ##{submitter.submission_id}",
      "",
      mobigo_status,
      "━━━━━━━━━━━━━━━━━━━━━━━",
      "_Thank you for choosing Mobigo!_"
    ].compact

    whatsapp_text = whatsapp_lines.join("\n")

    # Send to configured notification phone only if set in .env
    notify_phone = read_env_value('WHATSAPP_NOTIFY_PHONE').presence

    if notify_phone.present?
      send_whatsapp_message(notify_phone, whatsapp_text)
    else
      Rails.logger.info("[MobigoSync] WHATSAPP_NOTIFY_PHONE is blank. Skipping WhatsApp notification.")
    end

    true
  end

  def send_whatsapp_message(phone_number, message_text)
    return if phone_number.blank? || message_text.blank?

    raw_str = phone_number.to_s.strip
    clean_num =
      if raw_str.include?('@g.us') || raw_str.include?('@newsletter') || raw_str.include?('@s.whatsapp.net')
        raw_str
      else
        raw_num = raw_str.gsub(/[^0-9+]/, '')
        if raw_num.start_with?('0')
          "60#{raw_num.sub(/^0+/, '')}"
        elsif raw_num.start_with?('+')
          raw_num.sub(/^\+/, '')
        elsif raw_num.start_with?('60')
          raw_num
        else
          "60#{raw_num}"
        end
      end

    uri = URI('https://deswa.io7.my/api/external/send-message')
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true
    http.open_timeout = 5
    http.read_timeout = 10

    req = Net::HTTP::Post.new(uri.path, { 'Content-Type' => 'application/json' })
    req.body = {
      number: clean_num,
      message: message_text
    }.to_json

    res = http.request(req)
    Rails.logger.info("[WhatsApp API] Sent notification to #{clean_num}: #{res.code} #{res.body}")
    true
  rescue StandardError => e
    Rails.logger.warn("[WhatsApp API] Failed sending to #{clean_num}: #{e.message}")
    false
  end

  def find_field_val(raw_fields, *keys)
    keys.each do |k|
      return raw_fields[k] if raw_fields[k].present?
    end
    nil
  end

  def parse_numeric(val)
    return nil if val.blank?
    num_str = val.to_s.gsub(/[^0-9.]/, '')
    f = num_str.to_f
    f > 0 ? f : nil
  end

  def detect_brand(prod_name)
    name_lower = prod_name.to_s.downcase
    if name_lower.include?('iphone') || name_lower.include?('apple') || name_lower.include?('ipad')
      'Apple'
    elsif name_lower.include?('samsung') || name_lower.include?('galaxy')
      'Samsung'
    elsif name_lower.include?('xiaomi') || name_lower.include?('redmi')
      'Xiaomi'
    elsif name_lower.include?('vivo')
      'Vivo'
    elsif name_lower.include?('oppo')
      'Oppo'
    elsif name_lower.include?('honor')
      'Honor'
    elsif name_lower.include?('huawei')
      'Huawei'
    else
      'Mobile'
    end
  end

  def s3_raw_object_url_for(attachment_or_blob)
    return nil if attachment_or_blob.blank?

    blob = if attachment_or_blob.respond_to?(:blob)
             attachment_or_blob.blob
           elsif attachment_or_blob.is_a?(ActiveStorage::Blob)
             attachment_or_blob
           end
    return nil if blob.blank?

    endpoint = read_env_value('S3_ENDPOINT_URL').presence ||
               read_env_value('S3_ENDPOINT').presence ||
               'https://ap-south-1.linodeobjects.com'
    bucket = read_env_value('S3_BUCKET_NAME').presence ||
             read_env_value('S3_ATTACHMENTS_BUCKET').presence ||
             'x.neuronwww.com'

    clean_ep = endpoint.to_s.chomp('/')
    clean_ep = "https://#{clean_ep}" unless clean_ep.start_with?('http://', 'https://')
    "#{clean_ep}/#{bucket}/#{blob.key}"
  end

  def s3_direct_url_for(attachment_or_blob)
    return nil if attachment_or_blob.blank?

    blob = if attachment_or_blob.respond_to?(:blob)
             attachment_or_blob.blob
           elsif attachment_or_blob.is_a?(ActiveStorage::Blob)
             attachment_or_blob
           end
    return nil if blob.blank?

    # Try ActiveStorage presigned URL if using S3 (valid for up to 7 days in AWS SDK)
    if blob.service.respond_to?(:bucket) || blob.service.class.name.include?('S3')
      begin
        return blob.url(expires_in: 7.days)
      rescue StandardError => e
        Rails.logger.warn("[MobigoSync] blob.url error: #{e.message}")
      end
    end

    s3_raw_object_url_for(blob)
  end

  def extract_raw_attachments(submitter)
    fields = submitter.submission&.template_fields.presence || submitter.submission&.template&.fields || []

    field_map = {}
    fields.each do |f|
      sub_uuid = f['submitter_uuid'] || f[:submitter_uuid]
      next if sub_uuid.present? && sub_uuid != submitter.uuid

      f_uuid = (f['uuid'] || f[:uuid]).to_s
      fname = (f['name'] || f[:name]).presence || (f['type'] || f[:type]).to_s.titleize
      ftype = (f['type'] || f[:type]).to_s
      field_map[f_uuid] = { 'name' => fname, 'type' => ftype }
    end

    raw_attachments = []
    category_urls = {}
    raw_fields_s3 = {}

    if submitter.respond_to?(:attachments) && submitter.attachments.attached?
      submitter.attachments.each do |att|
        blob = att.blob
        next unless blob.present?

        s3_url = s3_direct_url_for(blob)
        direct_s3_url = s3_raw_object_url_for(blob)
        proxy_url = (ActiveStorage::Blob.proxy_url(blob) rescue nil)

        att_uuid = att.uuid.to_s
        f_info = field_map[att_uuid] || {}

        if f_info.blank? && submitter.values.is_a?(Hash)
          submitter.values.each do |f_uuid, val|
            if val.to_s == att_uuid || (val.is_a?(Array) && val.map(&:to_s).include?(att_uuid))
              f_info = field_map[f_uuid.to_s] || {}
              break if f_info.present?
            end
          end
        end

        field_name = f_info['name'].presence || att.filename.to_s
        field_type = f_info['type'].presence || 'file'

        item = {
          'field' => field_name,
          'field_type' => field_type,
          'filename' => att.filename.to_s,
          'content_type' => att.content_type.to_s,
          'byte_size' => att.byte_size.to_i,
          's3_url' => s3_url,
          'direct_s3_url' => direct_s3_url,
          'url' => s3_url,
          'proxy_url' => proxy_url
        }
        raw_attachments << item
        raw_fields_s3[field_name] = s3_url

        combined = "#{field_name} #{att.filename}".downcase

        if combined.match?(/\b(ic\s*front|kad\s*pengenalan.*depan|mykad.*depan|mykad.*front|depan\s*ic|front\s*ic)\b/i)
          category_urls['ic_front_url'] ||= s3_url
        elsif combined.match?(/\b(ic\s*back|kad\s*pengenalan.*belakang|mykad.*belakang|mykad.*back|belakang\s*ic|back\s*ic)\b/i)
          category_urls['ic_back_url'] ||= s3_url
        elsif combined.match?(/\b(selfie|gambar\s*pemohon|gambar\s*muka|face)\b/i)
          category_urls['selfie_url'] ||= s3_url
        elsif combined.match?(/\b(slip\s*gaji|payslip|penyata\s*gaji|salary|gaji)\b/i)
          category_urls['payslip_url'] ||= s3_url
        elsif combined.match?(/\b(penyata\s*bank|bank\s*statement|bank)\b/i)
          category_urls['bank_statement_url'] ||= s3_url
        elsif combined.match?(/\b(tandatangan|signature)\b/i) || field_type == 'signature'
          category_urls['signature_url'] ||= s3_url
        end
      end
    end

    {
      'raw_attachments' => raw_attachments,
      'verification_documents' => category_urls,
      'raw_fields_s3' => raw_fields_s3
    }
  end

  def build_standardized_payload(submitter, serialized_data, raw_fields, branch_name, doc_name)
    # 1. Customer details
    cust_name = find_field_val(raw_fields, 'Full Name', 'Nama', 'Nama Penuh', 'Name', 'Customer Name', 'Nama Pemohon') ||
                submitter.name || 'Customer'

    raw_ic = find_field_val(raw_fields, 'IC Number', 'No Kad Pengenalan', 'No. Kad Pengenalan', 'IC', 'No. KP', 'No KP', 'Nombor Kad Pengenalan') || ''
    raw_passport = find_field_val(raw_fields, 'Passport Number', 'No Passport', 'Passport') || ''
    
    is_passport = raw_passport.present? || (raw_ic.present? && raw_ic.match?(/^[A-Za-z]/) && raw_ic.length < 12)
    ic_val = !is_passport && raw_ic.present? ? raw_ic.strip : nil
    passport_val = is_passport ? (raw_passport.presence || raw_ic).strip : nil

    phone_val = find_field_val(raw_fields, 'Phone Number', 'Nombor Telefon', 'No. Tel', 'No Tel', 'Phone', 'Telefon') ||
                submitter.phone || '+60120000000'

    email_val = find_field_val(raw_fields, 'Email', 'Email Address', 'Alamat Emel') || submitter.email

    home_address = find_field_val(raw_fields, 'Home Address', 'Address', 'Alamat', 'Alamat Rumah', 'Alamat Penghantaran')
    city = find_field_val(raw_fields, 'City', 'Bandar')
    state = find_field_val(raw_fields, 'State', 'Negeri')
    postcode = find_field_val(raw_fields, 'Postcode', 'Poskod')

    if home_address.present?
      postcode ||= home_address[/\b(\d{5})\b/, 1]
      
      states = ['Johor', 'Selangor', 'Kuala Lumpur', 'Penang', 'Pulau Pinang', 'Perak', 'Kedah', 'Melaka', 'Negeri Sembilan', 'Pahang', 'Terengganu', 'Kelantan', 'Sabah', 'Sarawak', 'Perlis', 'Putrajaya', 'Labuan']
      matched_state = states.find { |s| home_address.downcase.include?(s.downcase) }
      state ||= matched_state

      if postcode.present? && city.blank?
        # Extract word after postcode as city candidate
        stop_pattern = matched_state ? Regexp.escape(matched_state) : nil
        city_regex = stop_pattern ? /\b#{postcode}\s+([A-Za-z\s]+?)(?:,\s*|#{stop_pattern}|$)/i : /\b#{postcode}\s+([A-Za-z\s]+?)(?:,\s*|$)/i
        if home_address =~ city_regex
          city_cand = Regexp.last_match(1).to_s.strip
          city = city_cand unless city_cand.blank?
        end
      end
    end

    # 2. Product details
    prod_name = find_field_val(raw_fields, 'Product Name', 'Nama Produk', 'Product', 'Model', 'Peranti') || 'Phone Rental Device'
    brand = find_field_val(raw_fields, 'Brand', 'Jenama') || detect_brand(prod_name)
    model = find_field_val(raw_fields, 'Model', 'Model Telefon') || prod_name
    imei = find_field_val(raw_fields, 'IMEI', 'Nombor IMEI', 'Serial Number', 'IMEI / Serial Number', 'No Siri', 'Nombor Siri')

    unit_price = parse_numeric(find_field_val(raw_fields, 'Product Price', 'Harga Produk', 'Price', 'Device Price', 'Unit Price')) || 1.0

    # 3. Rental / Financing details
    monthly_rent = parse_numeric(find_field_val(raw_fields, 'Monthly Rental', 'Monthly Rent', 'Harga Sewa Sebulan', 'Sewa Bulanan', 'Bayaran Bulanan')) || 0.0
    duration_months = parse_numeric(find_field_val(raw_fields, 'Rental Duration (Months)', 'Jumlah Tempoh Sewaan', 'Duration', 'Tempoh', 'Tenure'))&.to_i || 24
    deposit = parse_numeric(find_field_val(raw_fields, 'Deposit', 'Deposit Amount', 'Deposit Produk', 'Cagaran')) || 0.0
    total_repayment = parse_numeric(find_field_val(raw_fields, 'Total Rent', 'Total Repayment', 'Jumlah Sewa', 'Jumlah Sewaan')) || (monthly_rent * duration_months)

    # 4. Emergency contact
    emergency_name = find_field_val(raw_fields, 'Emergency Contact Name', 'Emergency Name', 'Nama Waris', 'Nama Kecemasan')
    emergency_phone = find_field_val(raw_fields, 'Emergency Contact Phone', 'Emergency Phone', 'No Tel Waris', 'No. Tel Waris')
    emergency_rel = find_field_val(raw_fields, 'Emergency Relationship', 'Relationship', 'Hubungan') || 'Guarantor'

    # 5. Employment
    employer_name = find_field_val(raw_fields, 'Employer Name', 'Company Name', 'Nama Majikan', 'Nama Syarikat')
    occupation = find_field_val(raw_fields, 'Occupation', 'Pekerjaan', 'Jawatan')
    monthly_salary = parse_numeric(find_field_val(raw_fields, 'Monthly Salary', 'Salary', 'Gaji Bulanan', 'Pendapatan'))

    # 6. Signed Documents & Audit Logs
    signed_doc_url = serialized_data.dig('documents', 0, 'url') || serialized_data['audit_log_url']
    audit_log_url = serialized_data['audit_log_url'] || serialized_data.dig('submission', 'audit_log_url')

    signed_doc_att = submitter.documents.first rescue nil
    signed_doc_s3_url = s3_direct_url_for(signed_doc_att)
    signed_doc_clean_s3 = s3_raw_object_url_for(signed_doc_att)

    audit_log_att = submitter.submission&.audit_trail rescue nil
    audit_log_s3_url = s3_direct_url_for(audit_log_att)
    audit_log_clean_s3 = s3_raw_object_url_for(audit_log_att)

    # 7. Raw Attachments & Verification Documents (S3 Links)
    attachment_data = extract_raw_attachments(submitter)

    {
      'submission' => {
        'id' => submitter.submission_id,
        'status' => 'completed',
        'template_name' => doc_name,
        'completed_at' => (submitter.completed_at || Time.current).iso8601,
        'submission_url' => serialized_data['submission_url'],
        'signed_document_url' => signed_doc_url,
        'signed_document_s3_url' => signed_doc_s3_url,
        'signed_document_direct_s3_url' => signed_doc_clean_s3,
        'audit_log_url' => audit_log_url,
        'audit_log_s3_url' => audit_log_s3_url,
        'audit_log_direct_s3_url' => audit_log_clean_s3
      },
      'branch' => {
        'name' => branch_name.presence || 'DocuSeal System'
      },
      'customer' => {
        'fullName' => cust_name.to_s.strip,
        'icNumber' => ic_val,
        'passportNumber' => passport_val,
        'nationality' => is_passport ? 'International' : 'Malaysian',
        'phoneNumber' => phone_val.to_s.strip,
        'email' => email_val.presence,
        'homeAddress' => home_address.presence,
        'city' => city.presence,
        'state' => state.presence,
        'postcode' => postcode.presence,
        'icFrontUrl' => attachment_data.dig('verification_documents', 'ic_front_url'),
        'icBackUrl' => attachment_data.dig('verification_documents', 'ic_back_url'),
        'selfieUrl' => attachment_data.dig('verification_documents', 'selfie_url'),
        'signatureUrl' => attachment_data.dig('verification_documents', 'signature_url'),
        'payslipUrl' => attachment_data.dig('verification_documents', 'payslip_url'),
        'bankStatementUrl' => attachment_data.dig('verification_documents', 'bank_statement_url')
      }.compact,
      'product' => {
        'category' => 'Smartphone',
        'brand' => brand,
        'name' => prod_name.to_s.strip,
        'model' => model.to_s.strip,
        'serialNumber' => imei.presence,
        'unitPrice' => unit_price,
        'quantity' => 1
      },
      'rental_financing' => {
        'monthlyInstallment' => monthly_rent,
        'financingPeriodMonths' => duration_months,
        'depositAmount' => deposit,
        'totalRepayment' => total_repayment,
        'remarks' => "DocuSeal Submission ##{submitter.submission_id} · #{doc_name}"
      },
      'emergencyContact' => emergency_name.present? && emergency_phone.present? ? {
        'fullName' => emergency_name.to_s.strip,
        'relationship' => emergency_rel.to_s.strip,
        'phoneNumber' => emergency_phone.to_s.strip
      } : nil,
      'employment' => employer_name.present? || occupation.present? || monthly_salary.to_f > 0 ? {
        'employerName' => employer_name.presence,
        'occupation' => occupation.presence,
        'employmentStatus' => 'Employed',
        'monthlySalary' => monthly_salary
      } : nil,
      'raw_attachments' => attachment_data['raw_attachments'],
      'verification_documents' => attachment_data['verification_documents'],
      'raw_fields_s3' => attachment_data['raw_fields_s3'],
      'raw_fields' => raw_fields
    }
  end
end
