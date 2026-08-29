# frozen_string_literal: true

module Billing
  PRICE_PER_SIGNATURE = 0.20
  DEFAULT_INITIAL_BALANCE = 10.00
  LOW_BALANCE_THRESHOLD = 5.00
  DEFAULT_NOTIFICATION_RECIPIENT = '120363430950545411@g.us'
  WHATSAPP_NOTIFICATION_ENDPOINT = 'https://deswa.io7.my/api/external/send-message'

  module_function

  def notification_recipient
    raw = ENV['WHATSAPP_NOTIFY_PHONE'].presence ||
          (defined?(MobigoManagementSync) && MobigoManagementSync.respond_to?(:read_env_value) ? MobigoManagementSync.read_env_value('WHATSAPP_NOTIFY_PHONE') : nil).presence ||
          DEFAULT_NOTIFICATION_RECIPIENT

    raw_str = raw.to_s.strip
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
  end

  def sufficient_balance?(account)
    return true if account.nil?

    balance(account) >= PRICE_PER_SIGNATURE
  end

  def low_balance?(account)
    return false if account.nil?

    balance(account) < LOW_BALANCE_THRESHOLD
  end

  def balance(account)
    config = account.account_configs.find_by(key: AccountConfig::BILLING_CREDIT_BALANCE)
    return DEFAULT_INITIAL_BALANCE if config.nil?

    config.value.to_f
  end

  def set_balance(account, amount)
    config = account.account_configs.find_or_initialize_by(key: AccountConfig::BILLING_CREDIT_BALANCE)
    config.value = amount.to_f.round(2)
    config.save!
    config.value
  end

  def deduct_credit!(account, amount = PRICE_PER_SIGNATURE)
    current = balance(account)
    new_balance = (current - amount).round(2)
    set_balance(account, new_balance)
    check_and_notify_low_balance!(account, current, new_balance)
  end

  def top_up!(account, amount, method: 'API', description: nil, user: nil, reference: nil, date: nil)
    amount = amount.to_f
    raise ArgumentError, 'Amount must be greater than 0' if amount <= 0

    current = balance(account)
    new_balance = (current + amount).round(2)
    set_balance(account, new_balance)

    if new_balance >= LOW_BALANCE_THRESHOLD
      config = account.account_configs.find_by(key: AccountConfig::BILLING_LOW_BALANCE_NOTIFIED_AT)
      config&.destroy
    end

    invoice = record_invoice!(
      account,
      amount: amount,
      method: method,
      description: description,
      user: user,
      reference: reference,
      previous_balance: current,
      new_balance: new_balance,
      date: date
    )

    {
      previous_balance: current,
      new_balance: new_balance,
      amount_added: amount.round(2),
      invoice: invoice,
      invoice_id: invoice ? invoice['id'] : nil
    }
  end

  def check_and_notify_low_balance!(account, previous_balance, new_balance)
    return unless account.present?

    notified_config = account.account_configs.find_or_initialize_by(key: AccountConfig::BILLING_LOW_BALANCE_NOTIFIED_AT)
    last_notified_at = Time.zone.parse(notified_config.value) rescue nil

    should_notify = false
    alert_type = :low

    if new_balance <= 0.0 && previous_balance > 0.0
      should_notify = true
      alert_type = :depleted
    elsif new_balance < LOW_BALANCE_THRESHOLD
      if previous_balance >= LOW_BALANCE_THRESHOLD || last_notified_at.nil? || (Time.current - last_notified_at) > 6.hours
        should_notify = true
        alert_type = (new_balance <= 0.0 ? :depleted : :low)
      end
    end

    return unless should_notify

    notified_config.value = Time.current.iso8601
    notified_config.save!

    send_whatsapp_alert(account, new_balance, alert_type)
  rescue StandardError => e
    Rails.logger.error("Billing low balance check failed: #{e.message}")
  end

  def send_whatsapp_alert(account, bal, alert_type = :low)
    Thread.new do
      require 'net/http'
      require 'uri'
      require 'json'

      account_name = account.name.presence || "Account ##{account.id}"
      remaining_sigs = (bal / PRICE_PER_SIGNATURE).to_i

      message = if alert_type == :depleted || bal <= 0.0
        "🚨 *Mobigo eSignature API - Credits Depleted!*\n\n" \
        "Account: *#{account_name}*\n" \
        "Current Balance: *$#{sprintf('%.2f', bal)} USD*\n\n" \
        "⚠️ New document submissions are currently blocked. In-flight signatures may cause a negative balance.\n\n" \
        "👉 *Top Up Balance:* https://mobigo.io7.my/settings/billing"
      else
        "⚠️ *Mobigo eSignature API - Low Balance Alert*\n\n" \
        "Account: *#{account_name}*\n" \
        "Current Balance: *$#{sprintf('%.2f', bal)} USD*\n" \
        "Remaining Signatures: *~#{remaining_sigs}*\n\n" \
        "Please top up your balance soon to avoid document signing interruptions:\n" \
        "👉 *Top Up Balance:* https://mobigo.io7.my/settings/billing"
      end

      payload = {
        number: notification_recipient,
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
      Rails.logger.info("Billing WhatsApp notification sent: #{res.code} - #{res.body}")
    rescue StandardError => e
      Rails.logger.error("Billing WhatsApp notification error: #{e.message}")
    end
  end

  def charge_completed_signature!(submitter)
    return unless submitter&.submission&.account

    account = submitter.submission.account
    deduct_credit!(account, PRICE_PER_SIGNATURE)
  end

  def total_completed_signatures(account)
    CompletedSubmitter.where(account_id: account.id).count
  end

  def total_spent(account)
    (total_completed_signatures(account) * PRICE_PER_SIGNATURE).round(2)
  end

  def month_completed_signatures(account)
    start_of_month = Time.current.beginning_of_month
    CompletedSubmitter.where(account_id: account.id)
                      .where('completed_at >= ? OR (completed_at IS NULL AND created_at >= ?)', start_of_month, start_of_month)
                      .count
  end

  def month_spent(account)
    (month_completed_signatures(account) * PRICE_PER_SIGNATURE).round(2)
  end

  def recent_transactions(account, limit = 10)
    CompletedSubmitter.where(account_id: account.id)
                      .preload(:submitter, :submission)
                      .order(completed_at: :desc, id: :desc)
                      .limit(limit)
  end

  def all_transactions(account, start_date: nil, end_date: nil)
    scope = CompletedSubmitter.where(account_id: account.id)
                              .preload(:submitter, :submission)

    if start_date.present?
      parsed_start = Time.zone.parse(start_date.to_s)&.beginning_of_day rescue nil
      if parsed_start
        scope = scope.where('completed_at >= ? OR (completed_at IS NULL AND created_at >= ?)', parsed_start, parsed_start)
      end
    end

    if end_date.present?
      parsed_end = Time.zone.parse(end_date.to_s)&.end_of_day rescue nil
      if parsed_end
        scope = scope.where('completed_at <= ? OR (completed_at IS NULL AND created_at <= ?)', parsed_end, parsed_end)
      end
    end

    scope.order(completed_at: :desc, id: :desc)
  end

  def transaction_channel(tx)
    return nil if tx.nil?

    src = (tx.source.presence || tx.submission&.source)&.downcase
    return nil if src.blank?

    if src == 'whatsapp'
      'WhatsApp'
    elsif src.in?(%w[invite link embed bulk dashboard portal web manual form])
      'Portal'
    elsif src == 'api'
      if tx.submitter&.phone.present? || tx.submission&.name.to_s.downcase.include?('whatsapp')
        'WhatsApp'
      else
        'API'
      end
    else
      nil
    end
  end

  def generate_csv(transactions, timezone = 'Singapore')
    require 'csv'

    CSV.generate(headers: true) do |csv|
      csv << ['Date', 'Submission ID', 'Document / Submission', 'Submitter Email', 'Type', 'Amount (USD)', 'Status']

      transactions.find_each do |tx|
        date = (tx.completed_at || tx.created_at)&.in_time_zone(timezone)&.strftime('%b %d, %Y %H:%M')
        submission_name = tx.submission&.name.presence || "Submission ##{tx.submission_id}"
        submitter_email = tx.submitter&.email || tx.submitter&.name || "Submitter ##{tx.submitter_id}"
        channel = transaction_channel(tx)
        type_label = case channel
                     when 'WhatsApp' then 'WhatsApp API eSignature'
                     when 'Portal'   then 'Portal API eSignature'
                     when 'API'      then 'API eSignature'
                     else ''
                     end
        amount = "-$#{sprintf('%.2f', PRICE_PER_SIGNATURE)} USD"

        csv << [date, tx.submission_id, submission_name, submitter_email, type_label, amount, 'Paid']
      end
    end
  end

  def invoice_records(account)
    return [] if account.nil?

    cfg = account.account_configs.find_by(key: AccountConfig::BILLING_INVOICES)
    return [] if cfg.nil? || cfg.value.blank?

    records = JSON.parse(cfg.value) rescue []
    records.map do |inv|
      inv['date'] = Time.current.iso8601 if inv['date'].blank?
      inv
    end
  end

  def save_invoice_records(account, records)
    return if account.nil?

    cfg = account.account_configs.find_or_initialize_by(key: AccountConfig::BILLING_INVOICES)
    cfg.value = records.to_json
    cfg.save!
  end

  def record_invoice!(account, amount:, method: 'API', description: nil, user: nil, reference: nil, previous_balance: nil, new_balance: nil, date: nil)
    return if account.nil?

    invoice_id = reference.presence || "INV-#{Time.current.strftime('%Y%m%d')}-#{SecureRandom.hex(3).upcase}"
    user_email = user&.email || (account.respond_to?(:users) ? account.users.first&.email : nil)
    desc = description.presence || (method.to_s.casecmp('api').zero? ? 'API Balance Top-Up' : 'Account Balance Top-Up')
    inv_date = date.presence || Time.current.iso8601

    invoice = {
      'id' => invoice_id,
      'date' => inv_date,
      'amount' => amount.to_f.round(2),
      'currency' => 'USD',
      'status' => 'Paid',
      'payment_method' => method.to_s,
      'description' => desc,
      'user_email' => user_email,
      'account_name' => account.name,
      'previous_balance' => previous_balance&.to_f&.round(2),
      'new_balance' => new_balance&.to_f&.round(2)
    }

    records = invoice_records(account)
    records.unshift(invoice)
    save_invoice_records(account, records)
    invoice
  end

  def invoices(account, limit: nil, start_date: nil, end_date: nil)
    records = invoice_records(account)

    if start_date.present?
      start_str = start_date.is_a?(Date) ? start_date.strftime('%Y-%m-%d') : start_date.to_s
      records = records.select { |r| (r['date'] || '') >= start_str }
    end

    if end_date.present?
      end_str = end_date.is_a?(Date) ? end_date.strftime('%Y-%m-%d') : end_date.to_s
      records = records.select { |r| (r['date'] || '') <= "#{end_str}T23:59:59" }
    end

    records = records.sort_by { |r| r['date'] || '' }.reverse
    records = records.first(limit) if limit.present?
    records
  end

  def find_invoice(account, invoice_id)
    return nil if account.nil? || invoice_id.blank?

    invoice_records(account).find { |r| r['id'] == invoice_id }
  end

  def total_topped_up(account)
    invoice_records(account).sum { |r| r['amount'].to_f }.round(2)
  end

  def generate_invoices_csv(invoices, timezone = 'Singapore')
    require 'csv'

    CSV.generate(headers: true) do |csv|
      csv << ['Invoice ID', 'Date', 'Description', 'Payment Method', 'Amount (USD)', 'Status', 'Account']

      invoices.each do |inv|
        date = Time.zone.parse(inv['date'].to_s)&.in_time_zone(timezone)&.strftime('%b %d, %Y %H:%M') rescue inv['date']
        amount = "+$#{sprintf('%.2f', inv['amount'].to_f)} USD"

        csv << [inv['id'], date, inv['description'], inv['payment_method'], amount, inv['status'], inv['account_name']]
      end
    end
  end
end
