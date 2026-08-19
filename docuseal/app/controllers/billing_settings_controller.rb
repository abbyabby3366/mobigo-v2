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
    @invoices = Billing.invoices(current_account, limit: 5)
    @total_topped_up = Billing.total_topped_up(current_account)
  end

  def top_up
    amount = params[:amount].to_f
    if amount <= 0
      return redirect_to settings_billing_index_path, alert: 'Please provide a valid top-up amount greater than 0.'
    end

    result = Billing.top_up!(
      current_account,
      amount,
      method: 'Dashboard',
      description: params[:description].presence || 'Dashboard Balance Top-Up',
      user: current_user
    )

    redirect_to settings_billing_index_path, notice: "Successfully added $#{sprintf('%.2f', result[:amount_added])} USD to your balance. Invoice #{result[:invoice_id]} generated."
  rescue ArgumentError => e
    redirect_to settings_billing_index_path, alert: e.message
  end

  def invoices
    @start_date = params[:start_date].presence
    @end_date = params[:end_date].presence
    @invoices = Billing.invoices(current_account, start_date: @start_date, end_date: @end_date)
    @total_topped_up = Billing.total_topped_up(current_account)

    respond_to do |format|
      format.html
      format.csv do
        filename_prefix = if @start_date.present? || @end_date.present?
                            "billing-invoices-filtered-#{Time.current.strftime('%Y%m%d%H%M%S')}.csv"
                          else
                            "billing-invoices-#{Time.current.strftime('%Y%m%d%H%M%S')}.csv"
                          end
        send_data Billing.generate_invoices_csv(@invoices, current_account&.timezone || 'Singapore'),
                  filename: filename_prefix,
                  type: 'text/csv'
      end
    end
  end

  def invoice
    @invoice = Billing.find_invoice(current_account, params[:id])
    if @invoice.nil?
      return redirect_to settings_billing_index_path, alert: 'Invoice not found.'
    end

    render layout: false if params[:print] == '1'
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
        send_data Billing.generate_csv(@transactions, current_account&.timezone || 'Singapore'),
                  filename: filename_prefix,
                  type: 'text/csv'
      end
    end
  end
end
