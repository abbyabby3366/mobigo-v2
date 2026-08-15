# frozen_string_literal: true

class DailyOrderSequence
  CONFIG_KEY = 'daily_order_sequence'

  def self.next_order_number(account = nil, date: Time.current)
    account ||= Account.first
    today_str = date.strftime('%Y%m%d')

    return generate_order_number(today_str, 0) unless account

    AccountConfig.transaction do
      config = AccountConfig.find_or_initialize_by(account: account, key: CONFIG_KEY)
      config.lock! if config.persisted?

      current_data = config.value.is_a?(Hash) ? config.value : {}

      if current_data['date'] == today_str
        current_counter = (current_data['counter'] || -1).to_i + 1
      else
        # Reset counter to 0 for a new day
        current_counter = 0
      end

      config.value = { 'date' => today_str, 'counter' => current_counter }
      config.save!

      generate_order_number(today_str, current_counter)
    end
  rescue StandardError => e
    Rails.logger.warn("DailyOrderSequence error: #{e.message}, falling back to default counter 0")
    generate_order_number(today_str, 0)
  end

  def self.peek_order_number(account = nil, date: Time.current)
    account ||= Account.first
    today_str = date.strftime('%Y%m%d')

    return generate_order_number(today_str, 0) unless account

    config = AccountConfig.find_by(account: account, key: CONFIG_KEY)
    current_data = config&.value.is_a?(Hash) ? config.value : {}

    if current_data['date'] == today_str
      next_counter = (current_data['counter'] || -1).to_i + 1
    else
      next_counter = 0
    end

    generate_order_number(today_str, next_counter)
  rescue StandardError => e
    generate_order_number(today_str, 0)
  end

  def self.generate_order_number(date_str, counter)
    suffix = if counter <= 99
               sprintf('%02d', counter)
             else
               counter.to_s(16).upcase.rjust(2, '0')
             end

    "#{date_str}#{suffix}"
  end
end
