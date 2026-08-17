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
    @recent_transactions = Billing.recent_transactions(current_account, 10)
  end

  def history
    @start_date = params[:start_date].presence
    @end_date = params[:end_date].presence

    @transactions = Billing.all_transactions(current_account, start_date: @start_date, end_date: @end_date)

    respond_to do |format|
      format.html do
        @pagy, @transactions = pagy(@transactions)
      end
      format.csv do
        filename_prefix = if @start_date.present? || @end_date.present?
                            "api-billing-activity-filtered-#{Time.current.strftime('%Y%m%d%H%M%S')}.csv"
                          else
                            "api-billing-activity-#{Time.current.strftime('%Y%m%d%H%M%S')}.csv"
                          end
        send_data Billing.generate_csv(@transactions),
                  filename: filename_prefix,
                  type: 'text/csv'
      end
    end
  end
end
