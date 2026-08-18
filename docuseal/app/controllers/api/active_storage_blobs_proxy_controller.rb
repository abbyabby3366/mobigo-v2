# frozen_string_literal: true

module Api
  class ActiveStorageBlobsProxyController < ApiBaseController
    include ActiveStorage::Streaming

    skip_before_action :authenticate_user!
    skip_authorization_check

    before_action :set_cors_headers
    before_action :set_noindex_headers
    before_action :set_security_headers

    # rubocop:disable Metrics
    def show
      blob_uuid, purp, exp = ApplicationRecord.signed_id_verifier.verified(params[:signed_uuid])

      if blob_uuid.blank? || purp != 'blob'
        Rollbar.error('Blob not found') if defined?(Rollbar)

        return head :not_found
      end

      blob = ActiveStorage::Blob.find_by!(uuid: blob_uuid)

      if Submitters::DANGEROUS_EXTENSIONS.include?(blob.filename.extension.to_s.downcase)
        Rollbar.error('Dangerous extension') if defined?(Rollbar)

        return head :unprocessable_content
      end

      attachment = blob.attachments.take

      @record = attachment.record
      @record = @record.record if @record.is_a?(ActiveStorage::Attachment)

      authorization_check!(attachment, @record, exp)

      if request.headers['Range'].present?
        send_blob_byte_range_data blob, request.headers['Range']
      else
        http_cache_forever public: true do
          response.headers['Accept-Ranges'] = 'bytes'

          if request.head?
            response.headers['Content-Type'] = blob.content_type_for_serving
            head :ok
          else
            custom_filename = resolve_download_filename(attachment, blob)
            blob.filename = ActiveStorage::Filename.new(custom_filename)
            send_blob_stream blob, disposition: params[:disposition] || 'attachment'
          end

          response.headers['Content-Length'] = blob.byte_size.to_s
        end
      end
    end
    # rubocop:enable Metrics

    private

    def resolve_download_filename(attachment, blob)
      return blob.filename.to_s unless blob.content_type.to_s.include?('pdf') || blob.filename.to_s.downcase.end_with?('.pdf')

      submitter = nil
      submission = nil

      if @record.is_a?(Submitter)
        submitter = @record
        submission = submitter.submission
      elsif @record.is_a?(Submission)
        submission = @record
        submitter = submission.submitters.where.not(completed_at: nil).order(:completed_at).last || submission.submitters.first
      end

      if submitter && submission
        # Extract order number
        order_number = nil
        (submission.template_fields || submission.template&.fields || []).each do |field|
          next unless field['name'].to_s.downcase =~ /\b(pesanan|order)\b/i

          val = submitter.values[field['uuid']] || submitter.values[field['name']]
          if val.present?
            order_number = val.to_s.strip
            break
          end
        end

        # Extract branch name
        branch_name = nil
        if submission.name.present? && submission.name =~ /\((.*?)\)/
          branch_name = Regexp.last_match(1).to_s.strip
        elsif submitter.values['branch_name'].present?
          branch_name = submitter.values['branch_name'].to_s.strip
        end

        base_title = submission.template&.name.to_s.downcase.include?('ctos') ? 'CTOS Consent Form' : 'Phone Rental'
        parts = [base_title]
        parts << order_number if order_number.present?
        result_title = parts.join(' ')
        result_title = "#{result_title} (#{branch_name})" if branch_name.present?

        return "#{result_title}.pdf"
      end

      clean_name = blob.filename.to_s.gsub(/\s*27062026/i, '').strip
      clean_name.presence || 'Phone Rental.pdf'
    end

    def authorization_check!(attachment, record, exp)
      return if attachment.name == 'logo'
      return if exp.to_i >= Time.current.to_i
      return if current_user && current_ability.can?(:read, record)

      if exp.blank?
        configs = record.account.account_configs.where(key: [AccountConfig::DOWNLOAD_LINKS_AUTH_KEY,
                                                             AccountConfig::DOWNLOAD_LINKS_EXPIRE_KEY])

        require_auth = configs.any? { |c| c.key == AccountConfig::DOWNLOAD_LINKS_AUTH_KEY && c.value }
        require_ttl = configs.none? { |c| c.key == AccountConfig::DOWNLOAD_LINKS_EXPIRE_KEY && c.value == false }

        return if !require_ttl && !require_auth
      end

      raise CanCan::AccessDenied
    end
  end
end
