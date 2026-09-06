# frozen_string_literal: true

require 'net/http'
require 'json'
require 'uri'
require 'logger'
begin
  require_relative 'mobigo_management_sync'
rescue LoadError
  # MobigoManagementSync may be autoloaded by Rails Zeitwerk
end

module AiFailureNotifier
  DEFAULT_NOTIFICATION_RECIPIENT = '120363430950545411@g.us'
  WHATSAPP_NOTIFICATION_ENDPOINT = 'https://deswa.io7.my/api/external/send-message'

  module_function

  def log_info(msg)
    if defined?(Rails.logger) && Rails.logger
      Rails.logger.info(msg)
    else
      puts "[AiFailureNotifier INFO] #{msg}"
    end
  end

  def log_error(msg)
    if defined?(Rails.logger) && Rails.logger
      Rails.logger.error(msg)
    else
      warn "[AiFailureNotifier ERROR] #{msg}"
    end
  end

  def format_recipient(raw)
    raw_str = raw.to_s.strip
    return nil if raw_str.empty?

    if raw_str.include?('@g.us') || raw_str.include?('@newsletter') || raw_str.include?('@s.whatsapp.net')
      raw_str
    else
      raw_num = raw_str.gsub(/[^0-9+]/, '')
      return nil if raw_num.empty?

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
  end

  def notification_recipients
    recipients = []

    # Read WHATSAPP_NOTIFY_PHONE from ENV or MobigoManagementSync (mobigo-v2/.env)
    raw_primary = ENV['WHATSAPP_NOTIFY_PHONE'].to_s.strip
    raw_primary = nil if raw_primary.empty?

    if raw_primary.nil? && defined?(MobigoManagementSync) && MobigoManagementSync.respond_to?(:read_env_value)
      sync_val = MobigoManagementSync.read_env_value('WHATSAPP_NOTIFY_PHONE').to_s.strip
      raw_primary = sync_val unless sync_val.empty?
    end

    raw_primary ||= DEFAULT_NOTIFICATION_RECIPIENT
    recipients.concat(raw_primary.to_s.split(/[;,]/)) if raw_primary.present? rescue recipients.concat(raw_primary.to_s.split(/[;,]/))

    formatted = recipients.map { |r| format_recipient(r) }.compact.uniq
    (formatted.nil? || formatted.empty?) ? [DEFAULT_NOTIFICATION_RECIPIENT] : formatted
  end

  def current_timestamp_str
    time_now = defined?(Time.current) ? Time.current : Time.now
    if time_now.respond_to?(:in_time_zone)
      time_now.in_time_zone('Singapore').strftime('%d %b %Y, %I:%M %p SGT')
    else
      time_now.strftime('%d %b %Y, %I:%M %p')
    end
  end

  def notify_primary_failure(template:, primary_model:, fallback_model:, error:, async: true)
    tpl_name = (template.respond_to?(:name) && template.name.to_s.strip.length > 0) ? template.name.to_s.strip : 'Document Agreement'
    time_str = current_timestamp_str
    clean_error = error.to_s.strip
    clean_error = clean_error[0...250] if clean_error.length > 250

    message = <<~MSG.strip
      ⚠️ *Mobigo AI Alert - Primary Model Failed*
      ━━━━━━━━━━━━━━━━━━━━━━━
      📑 *Template:* #{tpl_name}
      🤖 *Failed Primary Model:* #{primary_model}
      ❌ *Error:* #{clean_error}
      🔄 *Status:* Switching to fallback model (*#{fallback_model}*)...
      ⏰ *Time:* #{time_str}
      ━━━━━━━━━━━━━━━━━━━━━━━
      _Automated alert from Mobigo AI Engine_
    MSG

    dispatch(message, async: async)
  end

  def notify_fallback_failure(template:, primary_model:, fallback_model:, error:, errors_list: [], async: true)
    tpl_name = (template.respond_to?(:name) && template.name.to_s.strip.length > 0) ? template.name.to_s.strip : 'Document Agreement'
    time_str = current_timestamp_str
    clean_error = error.to_s.strip
    clean_error = clean_error[0...250] if clean_error.length > 250

    errors_summary = if errors_list.is_a?(Array) && !errors_list.empty?
                       errors_list.map { |e| "• #{e.to_s.strip[0...150]}" }.join("\n")
                     else
                       "• #{clean_error}"
                     end

    message = <<~MSG.strip
      🚨 *CRITICAL Mobigo AI Alert - Fallback Model Failed!*
      ━━━━━━━━━━━━━━━━━━━━━━━
      📑 *Template:* #{tpl_name}
      🤖 *Failed Primary:* #{primary_model}
      🔁 *Failed Fallback:* #{fallback_model}
      ❌ *Error Details:*
      #{errors_summary}

      🛑 *Status:* Document extraction FAILED. No model was able to extract data.
      👉 *Action Required:* Please check router status, API key, or model settings at https://mobigo.io7.my/settings/ai_credits
      ⏰ *Time:* #{time_str}
      ━━━━━━━━━━━━━━━━━━━━━━━
      _Urgent alert from Mobigo AI Engine_
    MSG

    dispatch(message, async: async)
  end

  def dispatch(message, async: true)
    send_proc = lambda do
      targets = notification_recipients
      targets.each do |target_recipient|
        payload = {
          number: target_recipient,
          message: message
        }

        uri = URI(WHATSAPP_NOTIFICATION_ENDPOINT)
        path = uri.request_uri.presence || uri.path.presence || '/api/external/send-message' rescue '/api/external/send-message'
        req = Net::HTTP::Post.new(path, { 'Content-Type' => 'application/json' })
        req.body = payload.to_json

        http = Net::HTTP.new(uri.hostname, uri.port)
        http.use_ssl = (uri.scheme == 'https')
        http.open_timeout = 8
        http.read_timeout = 8

        res = http.request(req)
        log_info("AiFailureNotifier WhatsApp alert sent to #{target_recipient}: #{res.code} - #{res.body}")
      rescue StandardError => e
        log_error("AiFailureNotifier dispatch error to #{target_recipient}: #{e.message}")
      end
    end

    if async
      Thread.new(&send_proc)
    else
      send_proc.call
    end
  rescue StandardError => e
    log_error("AiFailureNotifier thread spawn error: #{e.message}")
  end
end
