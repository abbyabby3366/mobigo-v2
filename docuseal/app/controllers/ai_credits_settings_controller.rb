# frozen_string_literal: true

class AiCreditsSettingsController < ApplicationController
  before_action do
    authorize!(:manage, current_account)
  end

  def index
    @balance = AiCredit.balance(current_account)
    @credits = AiCredit.credits(current_account)
    @api_key = AiCredit.api_key(current_account)
    @api_url = AiCredit.api_url(current_account)
    @model = AiCredit.model(current_account)
    @fallback_model = AiCredit.fallback_model(current_account)
    @recent_transactions = AiCredit.daily_transactions(current_account, limit: 5)
    @total_tool_calls = AiCredit.total_tool_calls(current_account)
    @total_credits_spent = AiCredit.total_credits_spent(current_account)
    @month_tool_calls = AiCredit.month_tool_calls(current_account)
    @month_credits_spent = AiCredit.month_credits_spent(current_account)
  end

  def history
    @start_date = params[:start_date].presence
    @end_date = params[:end_date].presence
    @transactions = AiCredit.daily_transactions(current_account, start_date: @start_date, end_date: @end_date)
    @total_tool_calls = AiCredit.total_tool_calls(current_account)
    @total_credits_spent = AiCredit.total_credits_spent(current_account)
    @month_tool_calls = AiCredit.month_tool_calls(current_account)
    @month_credits_spent = AiCredit.month_credits_spent(current_account)

    respond_to do |format|
      format.html
      format.csv do
        filename = if @start_date.present? || @end_date.present?
                     "ai-credit-usage-filtered-#{Time.current.strftime('%Y%m%d%H%M%S')}.csv"
                   else
                     "ai-credit-usage-#{Time.current.strftime('%Y%m%d%H%M%S')}.csv"
                   end
        send_data AiCredit.generate_csv(@transactions, current_account&.timezone || 'Singapore'),
                  filename: filename,
                  type: 'text/csv; charset=utf-8'
      end
    end
  end

  def create
    key = params[:ai_router_key]
    url = params[:ai_router_url]
    model = params[:ai_router_model]
    fallback_model = params[:ai_router_fallback_model]

    AiCredit.set_credentials(current_account, key: key, url: url, model: model, fallback_model: fallback_model)

    redirect_to settings_ai_credits_path, notice: 'AI Provider API credentials saved successfully.'
  end

  def check_balance
    result = AiCredit.fetch_provider_balance(current_account)

    respond_to do |format|
      format.html do
        if result[:success]
          redirect_to settings_ai_credits_path, notice: result[:message]
        else
          redirect_to settings_ai_credits_path, alert: result[:message]
        end
      end
      format.json do
        cur_cred = result[:credits] || AiCredit.credits(current_account) || 0
        cur_bal = result[:balance] || AiCredit.balance(current_account) || 0.0
        render json: {
          success: result[:success],
          balance: cur_bal,
          credits: cur_cred,
          credits_formatted: cur_cred.to_i == cur_cred ? cur_cred.to_i.to_s : sprintf('%.2f', cur_cred),
          usd_formatted: ActionController::Base.helpers.number_to_currency(cur_bal, unit: '$'),
          est_calls: (cur_cred / AiCredit::CREDITS_PER_TOOL_CALL).to_i,
          message: result[:message]
        }
      end
    end
  end
end
