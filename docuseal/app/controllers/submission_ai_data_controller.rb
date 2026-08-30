# frozen_string_literal: true

class SubmissionAiDataController < ApplicationController
  load_and_authorize_resource :submission

  def index
    prepare_ai_data
    render :index, layout: 'plain'
  end

  def show
    prepare_ai_data
    render :index, layout: 'plain'
  end

  private

  def prepare_ai_data
    raw_extracted = @submission.preferences&.dig('ai_extracted_data') || {}
    @ai_extracted_data = if raw_extracted.is_a?(String)
                           begin
                             JSON.parse(raw_extracted)
                           rescue StandardError
                             {}
                           end
                         else
                           raw_extracted
                         end

    @ai_text_notes = @submission.preferences&.dig('ai_text_notes')
    @ai_input_files = @submission.ai_input_files.to_a

    # Build Diff between original AI values vs current submission values
    orig_fields = (@ai_extracted_data['fields'] || @ai_extracted_data[:fields] || {}).transform_keys(&:to_s)
    orig_english_fields = (@ai_extracted_data['english_fields'] || @ai_extracted_data[:english_fields] || {}).transform_keys(&:to_s)
    orig_submitters = (@ai_extracted_data['submitters'] || @ai_extracted_data[:submitters] || [])

    # Collect all original values
    orig_combined = {}
    orig_submitters.each do |sub|
      s_vals = (sub['values'] || sub[:values] || {}).transform_keys(&:to_s)
      orig_combined.merge!(s_vals)
      orig_combined['Name'] ||= sub['name'] || sub[:name] if sub['name'] || sub[:name]
      orig_combined['Email'] ||= sub['email'] || sub[:email] if sub['email'] || sub[:email]
      orig_combined['Phone'] ||= sub['phone'] || sub[:phone] if sub['phone'] || sub[:phone]
    end
    orig_combined.merge!(orig_fields)

    # Collect current submission values
    current_combined = {}
    @submission.submitters.each do |sub|
      s_vals = (sub.values || {}).transform_keys(&:to_s)
      current_combined.merge!(s_vals)
      current_combined['Name'] ||= sub.name if sub.name.present?
      current_combined['Email'] ||= sub.email if sub.email.present?
      current_combined['Phone'] ||= sub.phone if sub.phone.present?
    end

    all_keys = (orig_combined.keys + current_combined.keys).uniq.reject(&:blank?).sort

    @field_diffs = all_keys.map do |key|
      orig_val = orig_combined[key].to_s.strip
      curr_val = current_combined[key].to_s.strip
      changed = orig_val.present? && curr_val.present? && orig_val != curr_val

      {
        field: key,
        original_value: orig_val.presence || '—',
        current_value: curr_val.presence || '—',
        changed: changed,
        added: orig_val.blank? && curr_val.present?,
        removed: orig_val.present? && curr_val.blank?
      }
    end
  end
end
