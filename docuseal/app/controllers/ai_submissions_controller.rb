# frozen_string_literal: true

class AiSubmissionsController < ApplicationController
  skip_before_action :verify_authenticity_token, only: :extract
  before_action :set_csp
  before_action :authenticate_user!
  before_action -> { authorize!(:create, Submission) }
  before_action :load_template, only: %i[template_fields extract create]
  before_action :ensure_sufficient_balance, only: :create

  def new
    @templates = (current_account ? current_account.templates : Template).active.order(name: :asc)

    @template = @templates.find_by(id: params[:template_id]) || @templates.first
  end

  def set_csp
    request.content_security_policy = current_content_security_policy.tap do |policy|
      policy.default_src :self
      policy.script_src :self, :unsafe_inline
      policy.style_src :self, :unsafe_inline
      policy.img_src :self, :https, :http, :blob, :data
      policy.font_src :self, :https, :http, :blob, :data
      policy.manifest_src :self
      policy.media_src :self
      policy.frame_src :self
      policy.worker_src :self, :blob
      policy.connect_src :self
    end
  end



  def template_fields
    render partial: 'template_fields', locals: { template: @template }
  end

  def extract
    text_data = params[:text].to_s
    files_data = params[:files] || []

    if text_data.blank? && files_data.blank?
      return render json: { error: 'Please provide some text or upload files (pictures/PDFs) to extract data.' }, status: :unprocessable_entity
    end

    result = AiSubmissionExtractor.call(
      template: @template,
      text: text_data,
      files: files_data
    )

    if result[:success]
      if params[:recipient_email].present? && result[:submitters].present?
        result[:submitters].first['email'] = params[:recipient_email] if result[:submitters].first['email'].blank?
      end

      respond_to do |format|
        format.json { render json: result }
        format.html do
          render partial: 'extracted_fields', locals: {
            template: @template,
            template_fields: @template.fields.to_a,
            extracted_data: result,
            submitters: result[:submitters],
            fields: result[:fields],
            summary: result[:summary],
            raw_json: result[:raw_json]
          }

        end
      end
    else
      render json: { error: result[:error] || 'Failed to extract data using AI.' }, status: :unprocessable_entity
    end
  rescue StandardError => e
    Rails.logger.error("AI Extraction error: #{e.message}\n#{e.backtrace.join("\n")}")
    render json: { error: "AI Extraction error: #{e.message}" }, status: :unprocessable_entity
  end

  def create
    authorize!(:create, Submission)

    if @template.archived_at?
      return redirect_to root_path, alert: I18n.t('template_has_been_archived')
    end

    submissions = create_submissions(@template, params)

    WebhookUrls.enqueue_events(submissions, 'submission.created')
    Submissions.send_signature_requests(submissions)
    SearchEntries.enqueue_reindex(submissions)

    respond_to do |format|
      format.html do
        redirect_to template_path(@template), notice: 'Document submission successfully created with AI!'
      end
      format.json do
        render json: {
          success: true,
          notice: 'Document submission successfully created with AI!',
          template_id: @template.id,
          submission_id: submissions.first&.id,
          redirect_url: template_path(@template)
        }
      end
    end
  rescue Submissions::CreateFromSubmitters::BaseError => e
    respond_to do |format|
      format.html do
        redirect_to new_ai_submission_path(template_id: @template.id), alert: e.message
      end
      format.json do
        render json: { error: e.message }, status: :unprocessable_entity
      end
    end
  rescue StandardError => e
    respond_to do |format|
      format.html do
        redirect_to new_ai_submission_path(template_id: @template&.id), alert: e.message
      end
      format.json do
        render json: { error: e.message }, status: :unprocessable_entity
      end
    end
  end

  private

  def load_template
    template_id = params[:template_id] || params.dig(:submission, :template_id)
    @template = (current_account ? current_account.templates : Template).active.find_by(id: template_id) || Template.active.find(template_id)
  end


  def create_submissions(template, params)
    raw_sub = params[:submission] || {}
    submitters_raw = raw_sub[:submitters] || raw_sub['submitters'] || []

    submitters_list = if submitters_raw.is_a?(ActionController::Parameters) || submitters_raw.is_a?(Hash)
                        submitters_raw.values
                      else
                        Array.wrap(submitters_raw)
                      end

    normalized_submitters = submitters_list.each_with_index.map do |s, idx|
      s_hash = s.is_a?(ActionController::Parameters) ? s.permit!.to_h : s.to_h
      values = s_hash[:values] || s_hash['values'] || {}

      t_sub = template.submitters.find { |ts| ts['uuid'] == (s_hash[:uuid] || s_hash['uuid']) } ||
              template.submitters[idx] ||
              template.submitters.first ||
              {}
      s_uuid = t_sub['uuid'] || s_hash[:uuid] || s_hash['uuid']
      s_role = s_hash[:role] || s_hash['role'] || t_sub['name'] || 'First Party'

      {
        uuid: s_uuid,
        name: s_hash[:name] || s_hash['name'],
        email: s_hash[:email] || s_hash['email'],
        phone: s_hash[:phone] || s_hash['phone'],
        role: s_role,
        'uuid' => s_uuid,
        'name' => s_hash[:name] || s_hash['name'],
        'email' => s_hash[:email] || s_hash['email'],
        'phone' => s_hash[:phone] || s_hash['phone'],
        'role' => s_role,
        values: values,
        'values' => values
      }
    end

    branch_name = raw_sub[:branch_name] || raw_sub['branch_name'] || params[:branch_name] || params.dig(:submission, :branch_name) || normalized_submitters.first&.dig(:values, 'branch_name')
    first_vals = normalized_submitters.first&.dig(:values) || normalized_submitters.first&.dig('values') || {}
    order_number = first_vals['Nombor Pesanan'] || first_vals['order_number'] || first_vals['No. Pesanan']

    base_title = template.name.to_s.downcase.include?('ctos') ? 'CTOS Consent Form' : 'Phone Rental'
    parts = [base_title]
    parts << order_number.to_s.strip if order_number.present?
    submission_name = parts.join(' ')
    submission_name = "#{submission_name} (#{branch_name.to_s.strip})" if branch_name.present?

    submissions_attrs = [{ name: submission_name, 'name' => submission_name, submitters: normalized_submitters, 'submitters' => normalized_submitters }]

    submissions_attrs, _, new_fields =
      Submissions::NormalizeParamUtils.normalize_submissions_params!(submissions_attrs, template, add_fields: true)

    Submissions.create_from_submitters(
      template: template,
      user: current_user,
      source: :invite,
      submitters_order: params[:preserve_order] == '1' ? 'preserved' : 'random',
      submissions_attrs: submissions_attrs,
      new_fields: new_fields,
      params: params.to_unsafe_h.merge('send_completed_email' => true)
    )
  end

  def ensure_sufficient_balance
    return if Billing.sufficient_balance?(current_account)

    redirect_to settings_billing_index_path, alert: "Insufficient API credit balance ($#{sprintf('%.2f', Billing.balance(current_account))} USD). Please top up your balance to send new document submissions."
  end
end
