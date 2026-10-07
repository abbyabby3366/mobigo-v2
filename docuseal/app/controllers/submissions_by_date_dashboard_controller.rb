# frozen_string_literal: true

class SubmissionsByDateDashboardController < ApplicationController
  load_and_authorize_resource :submission, parent: false, only: :index
  skip_authorization_check only: %i[download_zip documents]

  def index
    @submissions = @submissions.left_joins(:template)

    @submissions = @submissions.where(archived_at: nil)
                               .where(templates: { archived_at: nil })
                               .preload(:template_accesses, :created_by_user)

    @submissions = Submissions.search(current_user, @submissions, params[:q], search_template: true)

    @phone_only = params[:phone_only] != '0' && params[:phone_only] != 'false'
    if @phone_only
      t = Submission.arel_table
      tp = Template.arel_table
      @submissions = @submissions.where(t[:name].matches('%phone%').or(tp[:name].matches('%phone%')))
    end

    @base_submissions = Submissions::Filter.call(@submissions, current_user, params.except(:status, :phone_only))
    @all_count = @base_submissions.count
    @pending_count = @base_submissions.pending.count
    @completed_count = @base_submissions.completed.count

    @submissions = Submissions::Filter.call(@submissions, current_user, params.except(:phone_only))

    use_completed_date = params[:status] == 'completed' || params[:completed_at_from].present? || params[:completed_at_to].present?

    @submissions =
      if use_completed_date
        @submissions.order(completed_at: :desc, id: :desc)
      else
        @submissions.order(created_at: :desc, id: :desc)
      end

    @pagy, @submissions = pagy_auto(@submissions.select_for_list.preload(submitters: :start_form_submission_events))

    template_scope = @submissions.all?(&:template_submitters) ? Template.select_for_list : nil

    ActiveRecord::Associations::Preloader.new(records: @submissions,
                                              associations: :template,
                                              scope: template_scope).call

    ActiveRecord::Associations::Preloader.new(records: @submissions.filter_map(&:template),
                                              associations: :author).call

    timezone = current_account.timezone.presence || 'Asia/Kuala_Lumpur'
    @today_date = Time.current.in_time_zone(timezone).to_date
    @yesterday_date = @today_date - 1.day

    @submissions_by_date = @submissions.group_by do |sub|
      target_time = if use_completed_date && sub.completed_at.present?
                      sub.completed_at
                    else
                      sub.created_at
                    end
      target_time.in_time_zone(timezone).to_date
    end

    render 'submissions_by_date_dashboard/index'
  end

  def download_zip
    submissions = fetch_target_submissions
    return head :not_found if submissions.blank?

    require 'zip'

    used_filenames = Hash.new(0)
    zip_buffer = Zip::OutputStream.write_buffer do |zos|
      submissions.each do |submission|
        attachments = resolve_submission_attachments(submission)
        attachments.each do |attachment|
          blob = attachment.blob
          base_filename = resolve_submission_filename(submission, blob)
          count = (used_filenames[base_filename] += 1)
          entry_name = if count > 1
                         ext = File.extname(base_filename)
                         base = File.basename(base_filename, ext)
                         "#{base} (#{count})#{ext}"
                       else
                         base_filename
                       end

          zos.put_next_entry(entry_name)
          zos.write(blob.download)
        end
      end
    end

    date_str = params[:date].presence || Time.current.strftime('%d-%m-%Y')
    send_data zip_buffer.string,
              type: 'application/zip',
              disposition: 'attachment',
              filename: "submissions_#{date_str}.zip"
  end

  def documents
    submissions = fetch_target_submissions
    return head :not_found if submissions.blank?

    used_filenames = Hash.new(0)
    files = []

    submissions.each do |submission|
      attachments = resolve_submission_attachments(submission)
      attachments.each do |attachment|
        blob = attachment.blob
        base_filename = resolve_submission_filename(submission, blob)
        count = (used_filenames[base_filename] += 1)
        filename = if count > 1
                     ext = File.extname(base_filename)
                     base = File.basename(base_filename, ext)
                     "#{base} (#{count})#{ext}"
                   else
                     base_filename
                   end

        url = ActiveStorage::Blob.proxy_path(
          blob,
          expires_at: 1.hour.from_now.to_i,
          filename: filename
        )

        files << { url:, filename: }
      end
    end

    render json: files
  end

  private

  def fetch_target_submissions
    if params[:submission_ids].present?
      ids = Array.wrap(params[:submission_ids])
      return current_account.submissions.accessible_by(current_ability).where(id: ids)
    end

    submissions = current_account.submissions.accessible_by(current_ability)
                                 .left_joins(:template)
                                 .where(archived_at: nil)
                                 .where(templates: { archived_at: nil })

    phone_only = params[:phone_only] != '0' && params[:phone_only] != 'false'
    if phone_only
      t = Submission.arel_table
      tp = Template.arel_table
      submissions = submissions.where(t[:name].matches('%phone%').or(tp[:name].matches('%phone%')))
    end

    if params[:date].present?
      timezone = current_account.timezone.presence || 'Asia/Kuala_Lumpur'
      parsed_date = Date.parse(params[:date].to_s) rescue nil
      if parsed_date
        start_time = parsed_date.in_time_zone(timezone).beginning_of_day
        end_time = parsed_date.in_time_zone(timezone).end_of_day
        submissions = submissions.where(created_at: start_time..end_time)
      end
    end

    submissions
  end

  def resolve_submission_attachments(submission)
    last_completed = submission.submitters.where.not(completed_at: nil).order(:completed_at).last
    if last_completed
      Submissions::EnsureResultGenerated.call(last_completed)
      attachments = Submitters.select_attachments_for_download(last_completed)
      return attachments if attachments.present?
    end

    submission.documents.presence || submission.schema_documents.presence || submission.template&.documents || []
  end

  def resolve_submission_filename(submission, blob)
    last_completed = submission.submitters.where.not(completed_at: nil).order(:completed_at).last
    raw_name = if last_completed
                 Submitters.build_document_filename(last_completed, blob, nil)
               elsif submission.name.present?
                 "#{submission.name}.#{blob.filename.extension}"
               else
                 "#{submission.template&.name || blob.filename.base}.#{blob.filename.extension}"
               end
    raw_name.gsub(/[\\\/:\*\?"<>\|]/, '_')
  end
end
