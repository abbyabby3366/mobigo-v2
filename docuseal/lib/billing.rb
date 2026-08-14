# frozen_string_literal: true

module Billing
  PRICE_PER_SIGNATURE = 0.20
  DEFAULT_INITIAL_BALANCE = 10.00

  module_function

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
    new_balance = [current - amount, 0.0].max.round(2)
    set_balance(account, new_balance)
  end

  def top_up!(account, amount)
    amount = amount.to_f
    raise ArgumentError, 'Amount must be greater than 0' if amount <= 0

    current = balance(account)
    new_balance = (current + amount).round(2)
    set_balance(account, new_balance)
    {
      previous_balance: current,
      new_balance:,
      amount_added: amount.round(2)
    }
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
                      .order(completed_at: :desc)
                      .limit(limit)
  end
end
