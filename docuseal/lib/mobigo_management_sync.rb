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

    # 6. Signed Documents
    signed_doc_url = serialized_data.dig('documents', 0, 'url') || serialized_data['audit_log_url']
    audit_log_url = serialized_data['audit_log_url'] || serialized_data.dig('submission', 'audit_log_url')

    {
      'submission' => {
        'id' => submitter.submission_id,
        'status' => 'completed',
        'template_name' => doc_name,
        'completed_at' => (submitter.completed_at || Time.current).iso8601,
        'submission_url' => serialized_data['submission_url'],
        'signed_document_url' => signed_doc_url,
        'audit_log_url' => audit_log_url
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
        'postcode' => postcode.presence
      },
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
      'raw_fields' => raw_fields
    }
  end
end
