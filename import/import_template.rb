# frozen_string_literal: true

# Usage on Live Server:
# docker cp import_template.rb <docuseal_container_name>:/tmp/
# docker cp Phone_Rental_Service_Template.json <docuseal_container_name>:/tmp/
# docker exec -w /app <docuseal_container_name> bundle exec rails runner /tmp/import_template.rb /tmp/Phone_Rental_Service_Template.json

require 'json'
require 'base64'

json_path = ARGV[0] || 'Phone_Rental_Service_Template.json'
input_content = if File.exist?(json_path)
                  File.read(json_path)
                else
                  $stdin.read
                end

if input_content.blank?
  puts 'Error: No JSON data provided.'
  exit 1
end

data = JSON.parse(input_content)
user = User.first
unless user
  puts 'Error: No User found in database.'
  exit 1
end

account = user.account

template = account.templates.new(
  name: data['name'] || 'Phone Rental Service Template',
  author: user,
  submitters: data['submitters'] || [{ 'name' => 'First Party', 'uuid' => SecureRandom.uuid }],
  fields: data['fields'] || [],
  preferences: data['preferences'] || {},
  source: 'import'
)

Templates.maybe_assign_access(template)
template.save!

# Process and attach PDF document
doc_item = (data['documents'] || []).first
if doc_item
  raw_file = doc_item['file']
  pdf_bytes = if raw_file.to_s.start_with?('data:')
                Base64.decode64(raw_file.split(',', 2).last)
              else
                Base64.decode64(raw_file)
              end

  tempfile = Tempfile.new(['imported_doc', '.pdf'])
  tempfile.binmode
  tempfile.write(pdf_bytes)
  tempfile.rewind

  uploaded_file = ActionDispatch::Http::UploadedFile.new(
    tempfile: tempfile,
    filename: doc_item['name'] || 'Phone Rental Service 27062026.pdf',
    type: 'application/pdf'
  )

  documents, = Templates::CreateAttachments.call(template, { files: [uploaded_file] }, extract_fields: false)
  schema = documents.map { |doc| { 'attachment_uuid' => doc.uuid, 'name' => doc.filename.base } }

  new_att_uuid = schema.first['attachment_uuid']
  old_att_uuid = (data['schema'] || []).first&.dig('attachment_uuid')

  if old_att_uuid.present? && new_att_uuid.present? && old_att_uuid != new_att_uuid
    updated_fields = template.fields.map do |f|
      f_dup = f.deep_dup
      (f_dup['areas'] || []).each do |area|
        area['attachment_uuid'] = new_att_uuid if area['attachment_uuid'] == old_att_uuid
      end
      f_dup
    end
    template.fields = updated_fields
  end

  template.schema = schema
  template.save!

  tempfile.close
  tempfile.unlink
end

puts "============================================================"
puts "SUCCESS: Template '#{template.name}' successfully imported!"
puts "Template ID: #{template.id}"
puts "Total Fields: #{template.fields.size}"
puts "Readonly Fields: #{template.fields.count { |f| f['readonly'] }}"
puts "Signature Fields: #{template.fields.count { |f| f['type'] == 'signature' }}"
puts "Submitters: #{template.submitters.map { |s| s['name'] }.join(', ')}"
puts "============================================================"
