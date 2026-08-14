# frozen_string_literal: true

module Api
  class BillingController < ApiBaseController
    before_action do
      authorize!(:manage, current_user.account)
    end

    def show
      account = current_user.account

      render json: {
        account_id: account.id,
        account_name: account.name,
        balance: Billing.balance(account),
        currency: 'USD',
        rate_per_signature: Billing::PRICE_PER_SIGNATURE,
        total_completed_signatures: Billing.total_completed_signatures(account),
        total_spent: Billing.total_spent(account),
        this_month_completed_signatures: Billing.month_completed_signatures(account),
        this_month_spent: Billing.month_spent(account)
      }
    end

    def create
      account = current_user.account
      amount = params[:amount].to_f

      if amount <= 0
        return render json: { error: 'Invalid top-up amount. Amount must be greater than 0.' },
                      status: :unprocessable_content
      end

      result = Billing.top_up!(account, amount)

      render json: {
        success: true,
        message: "Successfully topped up $#{sprintf('%.2f', result[:amount_added])} USD",
        account_id: account.id,
        amount_added: result[:amount_added],
        previous_balance: result[:previous_balance],
        new_balance: result[:new_balance],
        currency: 'USD'
      }
    rescue ArgumentError => e
      render json: { error: e.message }, status: :unprocessable_content
    end
  end
end
