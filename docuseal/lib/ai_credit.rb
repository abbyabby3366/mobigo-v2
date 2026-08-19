# frozen_string_literal: true

require 'net/http'
require 'json'
require 'uri'

module AiCredit
  CREDITS_PER_USD = 100
  CREDITS_PER_TOOL_CALL = 3
  DEFAULT_ROUTER_URL = 'https://router.oino.dev/v1/chat/completions'
  DEFAULT_ROUTER_KEY = 'sk-e5b95619ac694e0a-a72568-c2160a10'
  DEFAULT_MODEL = 'cx/gpt-5.6-luna'
  DEFAULT_FALLBACK_MODEL = 'antigravity/gemini-3.6-flash-medium'

  module_function

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

  def set_credits(account, credits_amount)
    return nil if account.nil?
    return set_balance(account, nil) if credits_amount.nil?

    set_balance(account, credits_to_usd(credits_amount))
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
      set_balance(account, fetched_balance)
      credits_val = usd_to_credits(fetched_balance)
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
end
