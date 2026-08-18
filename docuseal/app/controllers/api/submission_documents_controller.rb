# frozen_string_literal: true

module Api
  class SubmissionDocumentsController < ApiBaseController
    load_and_authorize_resource :submission

    def index
      is_merge = params[:merge] == 'true' &&
                 (@submission.schema_documents || @submission.template.schema_documents).size > 1

      documents =
        if @submission.completed_at?
          build_completed_documents(@submission, merge: is_merge)
        else
          build_preview_documents(@submission, merge: is_merge)
        end

      expires_at = Accounts.link_expires_at(current_account)
      submitter = @submission.submitters.where.not(completed_at: nil).order(:completed_at).last || @submission.submitters.first
      clean_doc_name = if submitter
                         Submissions::GenerateResultAttachments.resolve_document_name(submitter, @submission.name || @submission.template&.name)
                       else
                         (@submission.name.presence || @submission.template&.name.to_s).gsub(/\s*27062026/i, '').strip.presence || 'Phone Rental'
                       end

      render json: {
        id: @submission.id,
        documents: documents.map do |attachment|
          doc_filename = "#{clean_doc_name}.#{attachment.blob.filename.extension}"
          { name: clean_doc_name, url: ActiveStorage::Blob.proxy_url(attachment.blob, expires_at:, filename: doc_filename) }
        end
      }
    end

    private

    def build_completed_documents(submission, merge: false)
      last_submitter = submission.submitters.select(&:completed_at?).max_by(&:completed_at)

      if merge
        if submission.merged_document_attachment.blank?
          submission.merged_document_attachment =
            Submissions::GenerateCombinedAttachment.call(last_submitter, with_audit: false)
        end

        [submission.merged_document_attachment]
      else
        if last_submitter.documents_attachments.blank?
          last_submitter.documents_attachments = Submissions::EnsureResultGenerated.call(last_submitter)
        end

        last_submitter.documents_attachments
      end
    end

    def build_preview_documents(submission, merge: false)
      values_hash = Submissions::GeneratePreviewAttachments.build_values_hash(submission)

      if merge
        if submission.preview_merged_document_attachment.present? &&
           submission.preview_merged_document_attachment.metadata['values_hash'] == values_hash
          [submission.preview_merged_document_attachment]
        else
          ApplicationRecord.no_touching { submission.preview_merged_document_attachment&.destroy }

          Submissions::GeneratePreviewAttachments.call(submission, values_hash:, merge: true)
        end
      elsif submission.preview_documents.present? &&
            submission.preview_documents.all? { |s| s.metadata['values_hash'] == values_hash }
        submission.preview_documents
      else
        ApplicationRecord.no_touching do
          submission.preview_documents.each(&:destroy)
        end

        Submissions::GeneratePreviewAttachments.call(submission, values_hash:)
      end
    end
  end
end
