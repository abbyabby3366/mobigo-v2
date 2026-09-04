# frozen_string_literal: true

require 'net/http'
require 'json'
require 'uri'

module AiCredit
  CREDITS_PER_USD = 100
  CREDITS_PER_TOOL_CALL = 3
  LOW_CREDITS_THRESHOLD_HIGH = 500
  LOW_CREDITS_THRESHOLD_LOW = 100
  DEFAULT_NOTIFICATION_RECIPIENT = '120363430950545411@g.us'
  WHATSAPP_NOTIFICATION_ENDPOINT = 'https://deswa.io7.my/api/external/send-message'
  DEFAULT_ROUTER_URL = 'https://router.oino.dev/v1/chat/completions'
  DEFAULT_ROUTER_KEY = 'sk-e5b95619ac694e0a-a72568-c2160a10'
  DEFAULT_MODEL = 'cx/gpt-5.6-luna'
  DEFAULT_FALLBACK_MODEL = 'antigravity/gemini-3.6-flash-medium'

  module_function

  def format_recipient(raw)
    raw_str = raw.to_s.strip
    return nil if raw_str.blank?

    if raw_str.include?('@g.us') || raw_str.include?('@newsletter') || raw_str.include?('@s.whatsapp.net')
      raw_str
    else
      raw_num = raw_str.gsub(/[^0-9+]/, '')
      return nil if raw_num.blank?

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

    # 1. Primary WhatsApp notify phone / group (receives both signings & credit alerts)
    raw_primary = ENV['WHATSAPP_NOTIFY_PHONE'].presence ||
                  (defined?(MobigoManagementSync) && MobigoManagementSync.respond_to?(:read_env_value) ? MobigoManagementSync.read_env_value('WHATSAPP_NOTIFY_PHONE') : nil).presence ||
                  DEFAULT_NOTIFICATION_RECIPIENT
    recipients.concat(raw_primary.to_s.split(/[;,]/)) if raw_primary.present?

    # 2. Specific Credits / Billing alert phone / group
    raw_credit = ENV['WHATSAPP_CREDIT_NOTIFY_PHONE'].presence ||
                 ENV['WHATSAPP_CREDITS_NOTIFY_PHONE'].presence ||
                 (defined?(MobigoManagementSync) && MobigoManagementSync.respond_to?(:read_env_value) ? (MobigoManagementSync.read_env_value('WHATSAPP_CREDIT_NOTIFY_PHONE') || MobigoManagementSync.read_env_value('WHATSAPP_CREDITS_NOTIFY_PHONE')) : nil).presence
    recipients.concat(raw_credit.to_s.split(/[;,]/)) if raw_credit.present?

    recipients.map { |r| format_recipient(r) }.compact.uniq
  end

  def notification_recipient
    notification_recipients.first || DEFAULT_NOTIFICATION_RECIPIENT
  end

  def usd_to_credits(usd)
    return nil if usd.nil?

    (usd.to_f * CREDITS_PER_USD).round(2)
  end

  def credits_to_usd(credits)
    return nil if credits.nil?

    (credits.to_f / CREDITS_PER_USD).round(4)
  end

  def sufficient_credits?(account, required_credits = CREDITS_PER_TOOL_CALL)
    return true if account.nil?

    cur = credits(account)
    return true if cur.nil?

    cur >= required_credits
  end

  def deduct_tool_call!(account, cost_in_credits = CREDITS_PER_TOOL_CALL, model: nil)
    return if account.nil?

    cur = credits(account)
    return if cur.nil?

    new_credits = [cur - cost_in_credits, 0.0].max
    set_credits(account, new_credits)
    record_tool_call!(account, credits_cost: cost_in_credits, model: model)
  end

  def daily_usage_records(account)
    return [] if account.nil?

    cfg = account.account_configs.find_by(key: AccountConfig::AI_DAILY_USAGE)
    return [] if cfg.nil? || cfg.value.blank?

    JSON.parse(cfg.value) rescue []
  end

  def save_daily_usage_records(account, records)
    return if account.nil?

    cfg = account.account_configs.find_or_initialize_by(key: AccountConfig::AI_DAILY_USAGE)
    cfg.value = records.to_json
    cfg.save!
  end

  def record_tool_call!(account, credits_cost: CREDITS_PER_TOOL_CALL, date: Date.current, model: nil)
    return if account.nil?

    date_str = date.strftime('%Y-%m-%d')
    records = daily_usage_records(account)

    existing_idx = records.find_index { |r| r['date'] == date_str }

    if existing_idx
      records[existing_idx]['tool_calls'] = (records[existing_idx]['tool_calls'] || 0) + 1
      records[existing_idx]['credits'] = (records[existing_idx]['credits'] || 0) + credits_cost
      records[existing_idx]['usd'] = (records[existing_idx]['credits'] / CREDITS_PER_USD.to_f).round(4)
      records[existing_idx]['last_used_at'] = Time.current.iso8601
    else
      new_record = {
        'date' => date_str,
        'tool_calls' => 1,
        'credits' => credits_cost,
        'usd' => (credits_cost / CREDITS_PER_USD.to_f).round(4),
        'last_used_at' => Time.current.iso8601
      }
      records.unshift(new_record)
    end

    records = records.sort_by { |r| r['date'] }.reverse
    save_daily_usage_records(account, records)
  end

  def daily_transactions(account, limit: nil, start_date: nil, end_date: nil)
    records = daily_usage_records(account)

    if start_date.present?
      start_str = start_date.is_a?(Date) ? start_date.strftime('%Y-%m-%d') : start_date.to_s
      records = records.select { |r| r['date'] >= start_str }
    end

    if end_date.present?
      end_str = end_date.is_a?(Date) ? end_date.strftime('%Y-%m-%d') : end_date.to_s
      records = records.select { |r| r['date'] <= end_str }
    end

    records = records.sort_by { |r| r['date'] }.reverse
    records = records.first(limit) if limit.present?
    records
  end

  def total_tool_calls(account)
    daily_usage_records(account).sum { |r| r['tool_calls'].to_i }
  end

  def total_credits_spent(account)
    daily_usage_records(account).sum { |r| r['credits'].to_f }
  end

  def total_usd_spent(account)
    (total_credits_spent(account) / CREDITS_PER_USD.to_f).round(2)
  end

  def month_tool_calls(account)
    current_month_prefix = Time.current.strftime('%Y-%m')
    daily_usage_records(account)
      .select { |r| r['date'].to_s.start_with?(current_month_prefix) }
      .sum { |r| r['tool_calls'].to_i }
  end

  def month_credits_spent(account)
    current_month_prefix = Time.current.strftime('%Y-%m')
    daily_usage_records(account)
      .select { |r| r['date'].to_s.start_with?(current_month_prefix) }
      .sum { |r| r['credits'].to_f }
  end

  def month_usd_spent(account)
    (month_credits_spent(account) / CREDITS_PER_USD.to_f).round(2)
  end

  def generate_csv(records, timezone = 'Singapore')
    require 'csv'

    CSV.generate(headers: true) do |csv|
      csv << ['Date', 'Activity', 'AI Tool Calls', 'Credits Used', 'Amount (USD)', 'Status']

      records.each do |rec|
        parsed_date = Date.parse(rec['date']) rescue nil
        formatted_date = parsed_date ? parsed_date.strftime('%b %d, %Y') : rec['date']
        calls = rec['tool_calls'].to_i
        credits_used = "-#{rec['credits'].to_i} Credits"
        amount_usd = "-$#{sprintf('%.2f', rec['usd'].to_f)} USD"

        csv << [formatted_date, 'AI Document Extraction', calls, credits_used, amount_usd, 'Completed']
      end
    end
  end

  def api_key(account)
    key = account&.account_configs&.find_by(key: AccountConfig::AI_ROUTER_KEY)&.value
    key.presence || ENV.fetch('AI_ROUTER_KEY', DEFAULT_ROUTER_KEY)
  end

  def api_url(account)
    url = account&.account_configs&.find_by(key: AccountConfig::AI_ROUTER_URL)&.value
    url.presence || ENV.fetch('AI_ROUTER_URL', DEFAULT_ROUTER_URL)
  end

  def model(account)
    mdl = account&.account_configs&.find_by(key: AccountConfig::AI_ROUTER_MODEL)&.value
    mdl.presence || ENV.fetch('AI_ROUTER_MODEL', DEFAULT_MODEL)
  end

  def fallback_model(account)
    mdl = account&.account_configs&.find_by(key: AccountConfig::AI_ROUTER_FALLBACK_MODEL)&.value
    mdl.presence || ENV.fetch('AI_ROUTER_FALLBACK_MODEL', DEFAULT_FALLBACK_MODEL)
  end

  def balance(account)
    return nil if account.nil?

    config = account.account_configs.find_by(key: AccountConfig::AI_CREDIT_BALANCE)
    return nil if config.nil? || config.value.blank?

    config.value.to_f
  end

  def credits(account)
    bal = balance(account)
    return nil if bal.nil?

    usd_to_credits(bal)
  end

  def set_balance(account, amount)
    return nil if account.nil?

    config = account.account_configs.find_or_initialize_by(key: AccountConfig::AI_CREDIT_BALANCE)
    if amount.nil?
      config.destroy if config.persisted?
      return nil
    end

    config.value = amount.to_f.round(2)
    config.save!
    config.value
  end

  def set_credits(account, credits_amount, record_invoice: true, user: nil, method: 'API', description: nil)
    return nil if account.nil?
    return set_balance(account, nil) if credits_amount.nil?

    old_credits = credits(account) || 0
    target_usd = credits_to_usd(credits_amount)
    set_balance(account, target_usd)

    diff_credits = (credits_amount - old_credits).round(2)
    if record_invoice && diff_credits > 0
      diff_usd = credits_to_usd(diff_credits)
      desc = description.presence || "#{diff_credits.to_i} AI credits"
      Billing.record_invoice!(
        account,
        amount: diff_usd,
        method: method,
        description: desc,
        user: user
      )
    end

    check_and_notify_low_credits!(account, old_credits, credits_amount)

    target_usd
  end

  def top_up!(account, credits: nil, usd: nil, method: 'API', user: nil, description: nil, reference: nil, date: nil)
    return if account.nil?

    usd_amount = if usd.present?
                   usd.to_f.round(2)
                 elsif credits.present?
                   credits_to_usd(credits)
                 else
                   0.0
                 end

    credits_count = usd_to_credits(usd_amount).to_i
    desc = description.presence || "#{credits_count} AI credits"

    current_bal = balance(account) || 0.0
    new_bal = (current_bal + usd_amount).round(2)
    set_balance(account, new_bal)

    old_credits = usd_to_credits(current_bal) || 0.0
    new_credits = usd_to_credits(new_bal) || 0.0
    check_and_notify_low_credits!(account, old_credits, new_credits)

    invoice = Billing.record_invoice!(
      account,
      amount: usd_amount,
      method: method,
      description: desc,
      user: user,
      reference: reference,
      previous_balance: current_bal,
      new_balance: new_bal,
      date: date
    )

    {
      previous_balance: current_bal,
      new_balance: new_bal,
      credits_added: credits_count,
      amount_added: usd_amount,
      invoice: invoice,
      invoice_id: invoice ? invoice['id'] : nil
    }
  end

  def set_credentials(account, key:, url: nil, model: nil, fallback_model: nil)
    return if account.nil?

    if key.present?
      cfg_key = account.account_configs.find_or_initialize_by(key: AccountConfig::AI_ROUTER_KEY)
      cfg_key.value = key.to_s.strip
      cfg_key.save!
    end

    if url.present?
      cfg_url = account.account_configs.find_or_initialize_by(key: AccountConfig::AI_ROUTER_URL)
      cfg_url.value = url.to_s.strip
      cfg_url.save!
    end

    if model.present?
      cfg_mdl = account.account_configs.find_or_initialize_by(key: AccountConfig::AI_ROUTER_MODEL)
      cfg_mdl.value = model.to_s.strip
      cfg_mdl.save!
    end

    if fallback_model.present?
      cfg_fb = account.account_configs.find_or_initialize_by(key: AccountConfig::AI_ROUTER_FALLBACK_MODEL)
      cfg_fb.value = fallback_model.to_s.strip
      cfg_fb.save!
    end
  end

  def fetch_provider_balance(account)
    key = api_key(account)
    base_url = api_url(account)

    uri_base = URI(base_url) rescue URI(DEFAULT_ROUTER_URL)
    host_origin = "#{uri_base.scheme}://#{uri_base.host}:#{uri_base.port}"

    balance_paths = [
      '/v1/user/balance',
      '/v1/credits',
      '/v1/balance',
      '/v1/user/credits',
      '/api/user/balance',
      '/v1/dashboard/billing/credit_grants'
    ]

    fetched_balance = nil

    balance_paths.each do |path|
      full_url = "#{host_origin}#{path}"
      uri = URI(full_url)
      req = Net::HTTP::Get.new(uri)
      req['Authorization'] = "Bearer #{key}"
      req['Accept'] = 'application/json'

      http = Net::HTTP.new(uri.hostname, uri.port)
      http.use_ssl = (uri.scheme == 'https')
      http.open_timeout = 5
      http.read_timeout = 5

      res = http.request(req)
      next unless res.is_a?(Net::HTTPSuccess)

      data = JSON.parse(res.body) rescue nil
      next if data.blank?

      val = data['balance'] || data['credits'] || data['total_available'] || data['available_balance'] || data.dig('data', 'balance')
      if val.present? && val.to_f >= 0
        fetched_balance = val.to_f.round(2)
        break
      end
    rescue StandardError => e
      Rails.logger.warn("AiCredit.fetch_provider_balance path #{path} failed: #{e.message}")
    end

    if fetched_balance.present?
      old_credits = credits(account) || 0.0
      set_balance(account, fetched_balance)
      credits_val = usd_to_credits(fetched_balance)
      check_and_notify_low_credits!(account, old_credits, credits_val)
      display_credits = credits_val.to_i == credits_val ? credits_val.to_i : sprintf('%.2f', credits_val)
      return {
        success: true,
        balance: fetched_balance,
        credits: credits_val,
        message: "Successfully fetched live AI balance from provider: #{display_credits} Credits ($#{sprintf('%.2f', fetched_balance)} USD)"
      }
    end

    cur_bal = balance(account)
    cur_cred = credits(account)
    {
      success: false,
      balance: cur_bal,
      credits: cur_cred,
      message: "AI provider balance endpoint unavailable for current credentials."
    }
  end

  def check_and_notify_low_credits!(account, previous_credits, new_credits)
    return unless account.present?

    previous_credits = (previous_credits || 0.0).to_f
    new_credits = (new_credits || 0.0).to_f

    tier_config = account.account_configs.find_or_initialize_by(key: AccountConfig::AI_CREDIT_LOW_NOTIFIED_TIER)
    current_tier = tier_config.value.presence

    # Reset or readjust tier if topped up
    if new_credits > LOW_CREDITS_THRESHOLD_HIGH
      tier_config.destroy if tier_config.persisted?
      return
    elsif new_credits > LOW_CREDITS_THRESHOLD_LOW && %w[100 0].include?(current_tier)
      # Partial top-up back above 100
      tier_config.value = '500'
      tier_config.save!
      return
    elsif new_credits > 0 && current_tier == '0'
      # Partial top-up back above 0
      tier_config.value = '100'
      tier_config.save!
      return
    end

    alert_type = nil
    new_tier = nil

    if new_credits <= 0.0
      if current_tier != '0'
        alert_type = :depleted
        new_tier = '0'
      end
    elsif new_credits <= LOW_CREDITS_THRESHOLD_LOW
      if !%w[100 0].include?(current_tier)
        alert_type = :low_100
        new_tier = '100'
      end
    elsif new_credits <= LOW_CREDITS_THRESHOLD_HIGH
      if current_tier.blank?
        alert_type = :low_500
        new_tier = '500'
      end
    end

    return unless alert_type && new_tier

    tier_config.value = new_tier
    tier_config.save!

    time_config = account.account_configs.find_or_initialize_by(key: AccountConfig::AI_CREDIT_LOW_NOTIFIED_AT)
    time_config.value = Time.current.iso8601
    time_config.save!

    send_whatsapp_alert(account, new_credits, alert_type)
  rescue StandardError => e
    Rails.logger.error("AiCredit low credits notification check failed: #{e.message}")
  end

  def send_whatsapp_alert(account, credits_count, alert_type = :low_500, async: true)
    send_proc = lambda do
      require 'net/http'
      require 'uri'
      require 'json'

      account_name = account.is_a?(Account) ? (account.name.presence || "Account ##{account.id}") : (account.to_s.presence || 'Main Account')
      credits_int = credits_count.to_i
      usd_val = credits_to_usd(credits_count) || 0.0
      remaining_extractions = (credits_count / CREDITS_PER_TOOL_CALL).to_i

      message = case alert_type
                when :depleted
                  "🛑 *Mobigo AI Extraction - AI Credits Depleted!*\n\n" \
                  "Account: *#{account_name}*\n" \
                  "Current AI Balance: *0 Credits* ($0.00 USD)\n\n" \
                  "❌ AI document extraction is currently blocked due to zero credit balance."
                when :low_100
                  "🚨 *Mobigo AI Extraction - Critical AI Credits Alert!*\n\n" \
                  "Account: *#{account_name}*\n" \
                  "Current AI Balance: *#{credits_int} Credits* (~$#{sprintf('%.2f', usd_val)} USD)\n" \
                  "Remaining AI Extractions: *~#{remaining_extractions}*\n\n" \
                  "⚠️ Less than 100 AI credits remaining! Please top up soon to prevent AI document extraction interruptions."
                else
                  "⚠️ *Mobigo AI Extraction - Low AI Credits Alert*\n\n" \
                  "Account: *#{account_name}*\n" \
                  "Current AI Balance: *#{credits_int} Credits* (~$#{sprintf('%.2f', usd_val)} USD)\n" \
                  "Remaining AI Extractions: *~#{remaining_extractions}*\n\n" \
                  "Your AI credits balance is getting low (500 credits or below). Please top up soon to ensure smooth document processing."
                end

      targets = notification_recipients
      last_res = nil
      targets.each do |target_recipient|
        payload = {
          number: target_recipient,
          message: message
        }

        uri = URI(WHATSAPP_NOTIFICATION_ENDPOINT)
        req = Net::HTTP::Post.new(uri, { 'Content-Type' => 'application/json' })
        req.body = payload.to_json

        http = Net::HTTP.new(uri.hostname, uri.port)
        http.use_ssl = (uri.scheme == 'https')
        http.open_timeout = 8
        http.read_timeout = 8

        res = http.request(req)
        Rails.logger.info("AiCredit WhatsApp notification sent to #{target_recipient}: #{res.code} - #{res.body}")
        last_res = res
      end
      last_res
    rescue StandardError => e
      Rails.logger.error("AiCredit WhatsApp notification error: #{e.message}")
      nil
    end

    if async
      Thread.new(&send_proc)
    else
      send_proc.call
    end
  end
end
