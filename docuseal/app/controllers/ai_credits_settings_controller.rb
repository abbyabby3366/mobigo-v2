# frozen_string_literal: true

class AiCreditsSettingsController < ApplicationController
  before_action do
    authorize!(:manage, current_account)
  end

  def index
    @balance = AiCredit.balance(current_account)
    @api_key = AiCredit.api_key(current_account)
    @api_url = AiCredit.api_url(current_account)
    @model = AiCredit.model(current_account)
    @fallback_model = AiCredit.fallback_model(current_account)
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
      format.json { render json: result }
    end
  end
end
