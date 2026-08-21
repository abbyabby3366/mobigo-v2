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
      serialized_data['dealerName'] = branch_name
      serialized_data['cawangan'] = branch_name

      # Ensure it is present in values array if not already present
      if serialized_data['values'].is_a?(Array)
        has_branch_field = serialized_data['values'].any? do |v|
          v.is_a?(Hash) && ['Branch Name', 'branch_name', 'Branch', 'Cawangan', 'cawangan'].include?(v['field'])
        end
        serialized_data['values'] << { 'field' => 'Branch Name', 'value' => branch_name } unless has_branch_field
      end
    end

    payload = {
      event_type: 'submission.completed',
      timestamp: Time.current.iso8601,
      data: serialized_data
    }

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

    raw_num = phone_number.to_s.gsub(/[^0-9+]/, '')
    clean_num =
      if raw_num.start_with?('0')
        "60#{raw_num.sub(/^0+/, '')}"
      elsif raw_num.start_with?('+')
        raw_num.sub(/^\+/, '')
      elsif raw_num.start_with?('60')
        raw_num
      else
        "60#{raw_num}"
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
end
