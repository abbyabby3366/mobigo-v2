# frozen_string_literal: true

module Api
  class AiSubmissionsController < ApiBaseController
    skip_before_action :verify_authenticity_token, raise: false
    before_action -> { authorize!(:create, Submission) }
    before_action :load_template, only: %i[extract create]

    rescue_from JSON::ParserError do |e|
      Rails.logger.error("JSON::ParserError in AiSubmissionsController: #{e.message}\n#{e.backtrace&.join("\n")}")
      render json: { error: "JSON parse error: #{e.message}" }, status: :unprocessable_entity
    end

    def extract
      text_data = params[:text].presence || params[:text_notes].to_s
      files_data = params[:files] || []

      if text_data.blank? && files_data.blank?
        return render json: { error: 'Please provide some text or upload files to extract data.' },
                      status: :unprocessable_entity
      end

      result = AiSubmissionExtractor.call(
        template: @template,
        text: text_data,
        files: files_data,
        account: current_account
      )

      if result[:success]
        if params[:recipient_email].present? && result[:submitters].present?
          result[:submitters].first['email'] = params[:recipient_email] if result[:submitters].first['email'].blank?
        end

        render json: result
      else
        render json: { error: result[:error] || 'Failed to extract data using AI.' },
               status: :unprocessable_entity
      end
    rescue StandardError => e
      Rails.logger.error("API AI Extraction error: #{e.message}\n#{e.backtrace.join("\n")}")
      render json: { error: "AI Extraction error: #{e.message}" }, status: :unprocessable_entity
    end

    private

    def load_template
      template_id = params[:template_id] || params.dig(:submission, :template_id)
      templates = current_account ? current_account.templates.active : Template.active
      @template = template_id.present? ? (templates.find_by(id: template_id) || Template.active.find_by(id: template_id)) : templates.first
      raise ActiveRecord::RecordNotFound, "Template not found#{template_id ? ": #{template_id}" : ''}" unless @template
    end
  end
end
