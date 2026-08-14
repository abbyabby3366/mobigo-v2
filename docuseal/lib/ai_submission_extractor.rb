# frozen_string_literal: true

require 'net/http'
require 'json'
require 'base64'

module AiSubmissionExtractor
  DEFAULT_ROUTER_URL = 'https://router.oino.dev/v1/chat/completions'
  DEFAULT_API_KEY = 'sk-e5b95619ac694e0a-a72568-c2160a10'
  DEFAULT_MODEL = 'antigravity/gemini-3.6-flash-medium'
  FALLBACK_MODELS = [
    'antigravity/gemini-3.6-flash-medium',
    'cursor/gemini-3.6-flash-medium',
    'auto/gemini',
    'gemini-3.6-flash'
  ].freeze

  module_function

  def call(template:, text: nil, files: [])
    api_url = ENV.fetch('AI_ROUTER_URL', DEFAULT_ROUTER_URL)
    api_key = ENV.fetch('AI_ROUTER_KEY', DEFAULT_API_KEY)
    primary_model = ENV.fetch('AI_ROUTER_MODEL', DEFAULT_MODEL)

    prompt_parts = build_prompt_parts(template, text, files)

    response_json = nil
    errors = []

    models_to_try = ([primary_model] + FALLBACK_MODELS).uniq

    models_to_try.each do |model|
      begin
        response_json = request_chat_completion(api_url, api_key, model, prompt_parts)
        break if response_json
      rescue StandardError => e
        errors << "#{model}: #{e.message}"
        Rails.logger.warn("AiSubmissionExtractor attempt failed with model #{model}: #{e.message}")
      end
    end

    raise "AI Extraction failed: #{errors.join('; ')}" if response_json.blank?

    parse_ai_response(response_json, template)
  end

  def build_prompt_parts(template, text, files)
    fields = template.fields.to_a
    submitters = template.submitters.to_a

    fields_description = fields.map do |f|
      sub = submitters.find { |s| s['uuid'] == f['submitter_uuid'] }
      sub_name = sub ? sub['name'] : 'Submitter'
      desc = "- Field Name: #{f['name'].inspect}"
      desc += ", Type: #{f['type'].inspect}"
      desc += ", UUID: #{f['uuid'].inspect}"
      desc += ", Assigned Role/Submitter: #{sub_name.inspect} (uuid: #{f['submitter_uuid'].inspect})"
      desc += ", Required: #{f['required'] ? 'Yes' : 'No'}"
      desc += ", Description: #{f['description'].inspect}" if f['description'].present?
      desc += ", Title: #{f['title'].inspect}" if f['title'].present?
      desc += ", Options: #{f['options'].inspect}" if f['options'].present?
      desc
    end.join("\n")

    submitters_description = submitters.map do |s|
      "- Submitter Role: #{s['name'].inspect} (uuid: #{s['uuid'].inspect})"
    end.join("\n")

    current_time = Time.current
    cur_date_str = current_time.strftime('%Y-%m-%d')
    cur_day = current_time.strftime('%d')
    cur_month = current_time.strftime('%m')
    cur_year = current_time.strftime('%Y')
    cur_short_year = current_time.strftime('%y')

    system_instructions = <<~INSTRUCTIONS
      You are an expert AI document processing assistant specializing in extracting and populating form fields for contracts, equipment/phone rental agreements (e.g. PERJANJIAN PERKHIDMATAN SEWA, Mobigo), customer identity documents (e.g. Malaysian MyKad / Kad Pengenalan), calculator screenshots, device box labels (IMEI, Serial Number), and customer WhatsApp/order notes.

      Current reference date: #{cur_date_str} (Day: #{cur_day}, Month: #{cur_month}, Year: #{cur_year}, Short Year: #{cur_short_year}).

      The target document template is: "#{template.name}".

      Expected submitters/parties for this document:
      #{submitters_description}

      All fields to populate for this template:
      #{fields_description}

      DOMAIN-SPECIFIC EXTRACTION RULES & FIELD MAPPING GUIDANCE:
      1. Contact & Identity Information:
         - Customer / Recipient Full Name ("Nama", "Nama Penerima", "Pihak B", "Name"): Extract from MyKad IC photo or text notes (e.g. MOHAMMAD FAIZ BIN MOHD KHATIP).
         - IC / Identity Card Number ("No. Kad Pengenalan", "No. KP", "IC", "NRIC"): Extract from MyKad image (e.g. 890425-02-5957).
         - Phone Number ("Nombor Telefon", "No. Tel", "Mobile"): Extract from WhatsApp/order text (e.g. 01153565717).
         - Email Address ("E-mel", "Email"): Extract from WhatsApp/order text (e.g. mohdfaiz5957@gmail.com).
         - Address ("Alamat", "Alamat Penghantaran", "Address"): Extract full residential or delivery address from MyKad or text notes.
      2. Device & Product Information:
         - Product Name / Model ("Nama Produk", "Model", "Device Model"): Extract phone model and capacity from text or box image (e.g. "iPhone 17 Pro Max 256GB" or "iPhone 17 Pro Max, 512GB").
         - IMEI / Serial Number ("Nombor IMEI Telefon/ Siri Telefon", "IMEI", "Serial No"): Extract from device box label (e.g. IMEI: 354704736663104 / Serial: LG93CV43WP).
         - Quantity ("Kuantiti Peralatan", "Quantity"): Usually "1".
      3. Rental, Pricing & Calculator Information:
         - Order Number ("Nombor Pesanan", "Order Number"): Extract from order text/title (e.g. 1308202600).
         - Retail Price ("Harga Pasaran/Harga Produk", "Harga Pasaran", "Retail Price"): Extract from calculator screenshot (e.g. "RM 6500" or "6500").
         - Deposit ("Deposit Produk", "Deposit Amount", "Deposit"): Extract from calculator screenshot (e.g. "RM 1950" or "1950").
         - Monthly Rent ("Harga Sewa Sebulan", "Monthly Rent", "Rent"): Extract from calculator screenshot (e.g. "RM 758.33" or "758.33").
         - Total Rent ("Jumlah Sewa", "Total Rent"): Calculate or extract total rent across all periods.
         - Duration / Period ("Jumlah Tempoh Sewaan", "Period", "Duration"): Extract from calculator (e.g. "13 Bulan" or "13 Period").
         - Start Date ("Tarikh mula sewaan", "Start Date"): e.g. "#{cur_date_str}" or from payment date.
         - End Date ("Tarikh akhir sewaan", "End Date"): Calculated from start date + period duration.
      4. Agreement Header & Split Date Fields:
         - If template has separate boxes for Day ("haribulan", "DD", "Day"), Month ("bulan", "MM", "Month"), and Year ("tahun", "YY", "YYYY"), fill with current date parts: Day = "#{cur_day}", Month = "#{cur_month}", Year = "#{cur_short_year}" or "#{cur_year}".
         - "Tarikh Penerimaan" / "Tarikh Dibuat": Fill with current date "#{cur_date_str}" or relevant Malaysian date format (DD-MM-YYYY or YYYY-MM-DD).
      5. Boolean / Checkbox Fields:
         - Set to true if agreed, accepted, or checked.
      6. Completeness:
         - Try to fill as many matching fields as possible from the provided text, screenshots, ID cards, and documents.
         - When a field name has close synonyms in Malay or English, map the extracted value accurately.

      CRITICAL: You MUST respond ONLY with a valid JSON object formatted EXACTLY as follows:
      {
        "summary": "Short 1-2 sentence overview of extracted data and source documents",
        "submitters": [
          {
            "uuid": "<submitter_uuid>",
            "role": "<submitter_role_name>",
            "name": "<extracted full name or empty>",
            "email": "<extracted email or empty>",
            "phone": "<extracted phone or empty>",
            "values": {
              "<field_name>": "<extracted value>"
            }
          }
        ],
        "fields": {
          "<field_name>": "<extracted value>"
        }
      }
    INSTRUCTIONS

    user_content = [
      { type: 'text', text: system_instructions }
    ]

    if text.present?
      user_content << {
        type: 'text',
        text: "\n--- USER PROVIDED TEXT, NOTES & INSTRUCTIONS ---\n#{text}\n"
      }
    end

    Array(files).each_with_index do |file_item, idx|
      process_uploaded_file(file_item, idx, user_content)
    end

    user_content
  end

  def process_uploaded_file(file_item, idx, user_content)
    return if file_item.blank?

    filename = file_item.respond_to?(:original_filename) ? file_item.original_filename : "file_#{idx}"
    content_type = file_item.respond_to?(:content_type) ? file_item.content_type : ''
    bytes = if file_item.respond_to?(:read)
              file_item.rewind if file_item.respond_to?(:rewind)
              file_item.read
            elsif file_item.is_a?(String)
              file_item
            end

    return if bytes.blank?

    if pdf_file?(filename, content_type)
      process_pdf_bytes(bytes, filename, user_content)
    elsif image_file?(filename, content_type)
      process_image_bytes(bytes, filename, content_type, user_content)
    else
      # Try treating as text/plain
      text_content = bytes.force_encoding('UTF-8')
      if text_content.valid_encoding?
        user_content << {
          type: 'text',
          text: "\n--- ATTACHED FILE [#{filename}] TEXT CONTENT ---\n#{text_content}\n"
        }
      end
    end
  rescue StandardError => e
    Rails.logger.warn("Error processing file #{filename}: #{e.message}")
  end

  def pdf_file?(filename, content_type)
    content_type.to_s.downcase.include?('pdf') || filename.to_s.downcase.end_with?('.pdf')
  end

  def image_file?(filename, content_type)
    content_type.to_s.downcase.start_with?('image/') ||
      filename.to_s.downcase.match?(/\.(png|jpe?g|webp|gif|bmp|tiff)$/)
  end

  def process_image_bytes(bytes, filename, content_type, user_content)
    mime = content_type.presence || (filename.downcase.end_with?('.png') ? 'image/png' : 'image/jpeg')
    b64 = Base64.strict_encode64(bytes)
    data_url = "data:#{mime};base64,#{b64}"

    user_content << {
      type: 'text',
      text: "\n[Attached Image Document: #{filename}]"
    }
    user_content << {
      type: 'image_url',
      image_url: { url: data_url }
    }
  end

  def process_pdf_bytes(bytes, filename, user_content)
    extracted_text = ''
    page_images = []

    begin
      doc = Pdfium::Document.open_bytes(bytes)
      total_pages = doc.page_count

      (0...[total_pages, 8].min).each do |page_index|
        page = doc.get_page(page_index)
        page_text = page.text.to_s.strip
        extracted_text += "\n--- PDF #{filename} Page #{page_index + 1} ---\n#{page_text}\n" if page_text.present?

        # Render page to bitmap for vision
        begin
          bitmap_data, w, h = page.render_to_bitmap(width: 1024)
          if bitmap_data.present? && defined?(Vips)
            image = Vips::Image.new_from_memory_copy(bitmap_data, w, h, 4, :uchar)
            jpg_buffer = image.write_to_buffer('.jpg', Q: 75)
            page_images << jpg_buffer
          end
        rescue StandardError => err
          Rails.logger.warn("Failed rendering page #{page_index} of #{filename}: #{err.message}")
        end
      end
    rescue StandardError => e
      Rails.logger.warn("Pdfium extraction failed for #{filename}: #{e.message}")
    ensure
      doc&.close
    end

    if extracted_text.present?
      user_content << {
        type: 'text',
        text: "\n--- EXTRACTED PDF TEXT [#{filename}] ---\n#{extracted_text}\n"
      }
    end

    page_images.each_with_index do |img_bytes, p_idx|
      b64 = Base64.strict_encode64(img_bytes)
      user_content << {
        type: 'text',
        text: "\n[PDF #{filename} Page #{p_idx + 1} Visual Scan]"
      }
      user_content << {
        type: 'image_url',
        image_url: { url: "data:image/jpeg;base64,#{b64}" }
      }
    end
  end

  def request_chat_completion(api_url, api_key, model, prompt_parts)
    uri = URI(api_url)
    req = Net::HTTP::Post.new(uri, {
      'Authorization' => "Bearer #{api_key}",
      'Content-Type' => 'application/json'
    })

    req.body = {
      model: model,
      stream: false,
      messages: [
        {
          role: 'user',
          content: prompt_parts
        }
      ]
    }.to_json

    http = Net::HTTP.new(uri.hostname, uri.port)
    http.use_ssl = (uri.scheme == 'https')
    http.read_timeout = 90
    http.open_timeout = 20

    res = http.request(req)

    unless res.is_a?(Net::HTTPSuccess)
      raise "HTTP #{res.code}: #{res.body}"
    end

    JSON.parse(res.body)
  end

  def parse_ai_response(response_json, template)
    content = response_json.dig('choices', 0, 'message', 'content') ||
              response_json.dig('choices', 0, 'delta', 'content') ||
              response_json.dig('message', 'content') ||
              response_json.dig('choices', 0, 'text') ||
              ''
    content = content.to_s.strip

    # Extract JSON between ```json ... ``` or first { ... }
    json_str = if content =~ /```(?:json)?\s*([\s\S]*?)\s*```/
                 Regexp.last_match(1).strip
               elsif content =~ /(\{[\s\S]*\})/
                 Regexp.last_match(1).strip
               else
                 content
               end

    parsed_data = JSON.parse(json_str)

    # Normalize submitters and fields
    submitters_map = (parsed_data['submitters'] || []).index_by { |s| s['uuid'] }
    template_submitters = template.submitters.to_a
    template_fields = template.fields.to_a

    fields_hash = parsed_data['fields'] || {}

    normalized_submitters = template_submitters.map do |ts|
      s_data = submitters_map[ts['uuid']] || {}
      s_values = s_data['values'] || {}

      # Assign any field values that belong to this submitter
      template_fields.select { |f| f['submitter_uuid'] == ts['uuid'] }.each do |f|
        f_name = f['name']
        if fields_hash.key?(f_name) && !s_values.key?(f_name)
          s_values[f_name] = fields_hash[f_name]
        elsif s_values.key?(f_name) && !fields_hash.key?(f_name)
          fields_hash[f_name] = s_values[f_name]
        end
      end

      {
        'uuid' => ts['uuid'],
        'role' => ts['name'],
        'name' => s_data['name'].to_s,
        'email' => s_data['email'].to_s,
        'phone' => s_data['phone'].to_s,
        'values' => s_values
      }
    end

    {
      success: true,
      summary: parsed_data['summary'] || 'Data extracted successfully.',
      submitters: normalized_submitters,
      fields: fields_hash,
      raw_json: parsed_data
    }
  rescue StandardError => e
    Rails.logger.error("Failed to parse AI response: #{e.message}\nRaw content: #{content}")
    {
      success: false,
      error: "Unable to parse AI response: #{e.message}",
      raw_content: content
    }
  end

end
