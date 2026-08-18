# frozen_string_literal: true

class DashboardController < ApplicationController
  skip_before_action :authenticate_user!, only: %i[index]

  before_action :maybe_redirect_product_url
  before_action :maybe_render_landing
  before_action :maybe_redirect_mfa_setup

  skip_authorization_check

  def index
    if params[:dashboard_view] == 'submissions'
      cookies.permanent[:dashboard_view] = 'submissions'
      session.delete(:templates_unlocked)
      SubmissionsDashboardController.dispatch(:index, request, response)
      return
    end

    if cookies.permanent[:dashboard_view] == 'templates'
      if params[:template_password].present?
        if params[:template_password] == '1234'
          session[:templates_unlocked] = true
          TemplatesDashboardController.dispatch(:index, request, response)
        else
          @template_password_error = true
          render 'dashboard/template_password_gate'
        end
      elsif session[:templates_unlocked]
        TemplatesDashboardController.dispatch(:index, request, response)
      else
        render 'dashboard/template_password_gate'
      end
    else
      session.delete(:templates_unlocked)
      SubmissionsDashboardController.dispatch(:index, request, response)
    end
  end

  private

  def maybe_redirect_product_url
    return if !Docuseal.multitenant? || signed_in?

    redirect_to Docuseal::PRODUCT_URL, allow_other_host: true
  end

  def maybe_redirect_mfa_setup
    return unless signed_in?
    return if current_user.otp_required_for_login

    return if !current_user.otp_required_for_login && !AccountConfig.exists?(value: true,
                                                                             account_id: current_user.account_id,
                                                                             key: AccountConfig::FORCE_MFA)

    redirect_to mfa_setup_path, notice: I18n.t('setup_2fa_to_continue')
  end

  def maybe_render_landing
    return if signed_in?

    render 'pages/landing'
  end
end
