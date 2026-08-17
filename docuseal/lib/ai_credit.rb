# frozen_string_literal: true

require 'net/http'
require 'json'
require 'uri'

module AiCredit
  DEFAULT_ROUTER_URL = 'https://router.oino.dev/v1/chat/completions'
  DEFAULT_ROUTER_KEY = 'sk-e5b95619ac694e0a-a72568-c2160a10'
  DEFAULT_MODEL = 'antigravity/gemini-3.6-flash-medium'

  module_function

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

  def balance(account)
    return nil if account.nil?

    config = account.account_configs.find_by(key: AccountConfig::AI_CREDIT_BALANCE)
    return nil if config.nil? || config.value.blank?

    config.value.to_f
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

  def set_credentials(account, key:, url: nil, model: nil)
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
      return {
        success: true,
        balance: fetched_balance,
        message: "Successfully fetched live AI balance from provider: $#{sprintf('%.2f', fetched_balance)} USD"
      }
    end

    cur_bal = balance(account)
    {
      success: false,
      balance: cur_bal,
      message: "AI provider balance endpoint unavailable for current credentials."
    }
  end
end
