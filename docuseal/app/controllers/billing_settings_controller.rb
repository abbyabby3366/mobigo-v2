# frozen_string_literal: true

class BillingSettingsController < ApplicationController
  before_action do
    authorize!(:manage, current_account)
  end

  def index
    @balance = Billing.balance(current_account)
    @price_per_signature = Billing::PRICE_PER_SIGNATURE
    @total_completed = Billing.total_completed_signatures(current_account)
    @total_spent = Billing.total_spent(current_account)
    @month_completed = Billing.month_completed_signatures(current_account)
    @month_spent = Billing.month_spent(current_account)
    @recent_transactions = Billing.recent_transactions(current_account, 15)
  end
end
