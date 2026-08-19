# frozen_string_literal: true

require 'net/http'
require 'json'
require 'base64'

module AiSubmissionExtractor
  DEFAULT_ROUTER_URL = 'https://router.oino.dev/v1/chat/completions'
  DEFAULT_API_KEY = 'sk-e5b95619ac694e0a-a72568-c2160a10'
  DEFAULT_MODEL = 'cx/gpt-5.6-luna'
  DEFAULT_FALLBACK_MODEL = 'antigravity/gemini-3.6-flash-medium'
  FALLBACK_MODELS = [
    'antigravity/gemini-3.6-flash-medium',
    'antigravity/3.6flash',
    'antigravity/gemini-3.6-flash',
    'cursor/gemini-3.6-flash-medium',
    'auto/gemini',
    'gemini-3.6-flash'
  ].freeze

  module_function

  def call(template:, text: nil, files: [], account: nil)
    acc = account || template&.account
    if acc.present? && !AiCredit.sufficient_credits?(acc, AiCredit::CREDITS_PER_TOOL_CALL)
      raise "Insufficient AI credit balance (#{AiCredit.credits(acc).to_i} Credits). Please top up or sync your AI credits at /settings/ai_credits."
    end

    api_url = AiCredit.api_url(acc)
    api_key = AiCredit.api_key(acc)
    primary_model = AiCredit.model(acc)
    fallback_model = AiCredit.fallback_model(acc)

    prompt_parts = build_prompt_parts(template, text, files)

    response_json = nil
    errors = []

    models_to_try = ([primary_model, fallback_model] + FALLBACK_MODELS).compact.map(&:to_s).map(&:strip).reject(&:blank?).uniq

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

    parsed = parse_ai_response(response_json, template, acc || template&.account)
    AiCredit.deduct_tool_call!(acc || template&.account) if parsed.is_a?(Hash) && parsed[:success]
    parsed
  end

  def build_prompt_parts(template, text, files)
    fields = template.fields.to_a
    submitters = template.submitters.to_a

    raw_fields = fields.select { |f| f['type'] != 'signature' && !processed_data_field?(f['name'], f['type']) }

    raw_fields_description = raw_fields.map do |f|
      sub = submitters.find { |s| s['uuid'] == f['submitter_uuid'] }
      sub_name = sub ? sub['name'] : 'Submitter'
      desc = "- Raw Field Name: #{f['name'].inspect}"
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

    system_instructions = <<~INSTRUCTIONS
      You are an expert AI document processing assistant specializing in extracting structured RAW DATA from customer identity documents (e.g. Malaysian MyKad / Kad Pengenalan), calculator screenshots, device box labels (IMEI, Serial Number), and customer WhatsApp/order notes for equipment/phone rental agreements (e.g. PERJANJIAN PERKHIDMATAN SEWA, Mobigo).

      The target document template is: "#{template.name}".

      Expected submitters/parties for this document:
      #{submitters_description}

      CRITICAL INSTRUCTION:
      Extract ONLY RAW DATA fields listed below. DO NOT extract, calculate, or include PROCESSED fields (such as Order Number or Date fields) or Signatures.

      RAW FIELDS TO EXTRACT FOR THIS TEMPLATE (#{raw_fields.size}):
      #{raw_fields_description}

      DOMAIN-SPECIFIC RAW EXTRACTION RULES & FIELD MAPPING GUIDANCE:
      1. Contact & Identity Information:
         - Customer / Recipient Full Name ("Nama", "Nama Penerima", "Pihak B", "Name"): Extract from MyKad IC photo or text notes (e.g. MOHAMMAD FAIZ BIN MOHD KHATIP).
         - IC / Identity Card Number ("No. Kad Pengenalan", "No. KP", "IC", "NRIC"): Extract from MyKad image (e.g. 890425-02-5957).
         - Phone Number ("Nombor Telefon", "No. Tel", "Mobile"): Extract from WhatsApp/order text (e.g. 01153565717).
         - Email Address ("E-mel", "Email"): Extract from WhatsApp/order text (e.g. mohdfaiz5957@gmail.com).
         - Address ("Alamat", "Alamat Penghantaran", "Address"): Extract full residential or delivery address from MyKad or text notes.
         - Branch / Cawangan Name ("branch_name", "Branch Name", "branch", "Cawangan", "cawangan", "Nama Cawangan"): Extract branch name from notes or text if provided (e.g. "branch name: ABC Holdings" -> "ABC Holdings"). Put in fields["branch_name"].

      2. Device & Product Information:
         - Product Name / Model ("Nama Produk", "Model", "Device Model"): Extract phone model and capacity from text or box image (e.g. "iPhone 17 Pro Max 256GB" or "iPhone 17 Pro Max, 512GB").
         - Primary IMEI / IMEI 1 ("IMEI1", "imei1", "IMEI", "IMEI / MEID"): Extract primary 15-digit IMEI from device box label (e.g. "354704736663104" or "358701814261211").
         - Secondary IMEI / IMEI 2 ("IMEI2", "imei2"): Extract secondary 15-digit IMEI from device box label if present (e.g. "354704736416883" or "358701818872716"). If device only has 1 IMEI, leave empty.
         - Serial Number ("Siri Telefon", "Serial No", "Serial"): Extract serial number from box label (e.g. "LG93CV43WP").
         - Quantity ("Kuantiti Peralatan", "Quantity"): Usually "1".
         - Note: DO NOT combine IMEIs into "Nombor IMEI"; extract "imei1" and "imei2" separately as RAW fields.

      3. Rental Pricing & Calculator Screenshots (e.g. dark blue calculator UI with Period table):
         - Selected Period ("calculator_period", "period", "tempoh"): ALWAYS extract the selected period from the calculator UI (e.g. from the Period dropdown box "13Period", "* Period", or table text "Period: 13Period" -> "13Period" or "13"). Put this in the root "calculator_period" and fields["period"].
         - Retail / Product Price ("Harga Produk", "Harga Pasaran", "Retail Price"): Extract pure numeric price (e.g. top price box "6500" or "Retail Price: RM 6500" -> "6500").
         - Deposit Amount ("Deposit Produk", "Deposit Amount", "Deposit"): Extract pure numeric deposit (e.g. "Deposit Amount" box "1950" -> "1950").
         - Monthly Rent ("Harga Sewa Sebulan", "Monthly Rent", "Rent"): Extract monthly rental amount from table "Rent" column / Period rows (e.g. "758.33").
         - Note: DO NOT calculate or extract PROCESSED fields:
           * "Jumlah Sewa" (system computed: Monthly Rent * Rental Duration)
           * "Jumlah Tempoh Sewaan" (system computed: Period - 1, e.g. 13 - 1 = 12)
           * "Tarikh mula sewaan" (system computed: today's date)
           * "Tarikh akhir sewaan" (system computed: today's date + X months where X = Jumlah Tempoh Sewaan)

      4. Boolean / Checkbox Fields:
         - Set to true if agreed, accepted, or checked.

      5. Completeness:
         - Try to fill as many matching RAW fields as possible from the provided text, screenshots, ID cards, and documents.
         - When a raw field name has close synonyms in Malay or English, map the extracted value accurately.

      CRITICAL: You MUST respond ONLY with a valid JSON object formatted EXACTLY as follows:
      {
        "summary": "Short 1-2 sentence overview of extracted raw data and source documents",
        "calculator_period": "<extracted raw period, e.g. '13Period' or '13' or '6'>",
        "submitters": [
          {
            "uuid": "<submitter_uuid>",
            "role": "<submitter_role_name>",
            "name": "<extracted full name or empty>",
            "email": "<extracted email or empty>",
            "phone": "<extracted phone or empty>",
            "values": {
              "<raw_field_name>": "<extracted raw value>"
            }
          }
        ],
        "fields": {
          "period": "<extracted raw period, e.g. '13Period' or '13'>",
          "branch_name": "<extracted branch name or empty, e.g. 'ABC Holdings'>",
          "imei1": "<extracted 15-digit IMEI 1>",
          "imei2": "<extracted 15-digit IMEI 2 or empty>",
          "<raw_field_name>": "<extracted raw value>"
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

    filename = if file_item.respond_to?(:original_filename)
                 file_item.original_filename
               elsif file_item.respond_to?(:filename)
                 file_item.filename.to_s
               else
                 "file_#{idx}"
               end

    content_type = file_item.respond_to?(:content_type) ? file_item.content_type.to_s : ''

    bytes = if file_item.respond_to?(:tempfile) && file_item.tempfile.respond_to?(:path) && File.exist?(file_item.tempfile.path)
              File.binread(file_item.tempfile.path)
            elsif file_item.respond_to?(:read)
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

  TRANSLATIONS = {
    # Agreement date / Split dates
    'Day Of Date' => 'Agreement Day (DD)',
    'Day of Date' => 'Agreement Day (DD)',
    'Day of Agreement' => 'Agreement Day (DD)',
    'Haribulan' => 'Day of Month',
    'Hari' => 'Day',
    'Month Of Date' => 'Agreement Month (MM)',
    'Month of Date' => 'Agreement Month (MM)',
    'Month of Agreement' => 'Agreement Month (MM)',
    'Bulan' => 'Month',
    'Year of Date' => 'Agreement Year (YY)',
    'Year Of Date' => 'Agreement Year (YY)',
    'Year of Agreement' => 'Agreement Year (YY)',
    'Tahun' => 'Year (YY)',
    'Date' => 'Agreement / Signing Date',
    'Tarikh' => 'Agreement / Signing Date',
    'Tarikh Penerimaan' => 'Receipt Date',
    'Tarikh mula sewaan' => 'Rental Start Date',
    'Tarikh akhir sewaan' => 'Rental End Date',

    # Order & Rental Terms
    'Nombor Pesanan' => 'Order Number',
    'No. Pesanan' => 'Order Number',
    'No Pesanan' => 'Order Number',
    'Order Number' => 'Order Number',
    'Harga Sewa Sebulan' => 'Monthly Rental Price',
    'Sewa Sebulan' => 'Monthly Rental Price',
    'Jumlah Sewa' => 'Total Rental Amount',
    'Jumlah Sewaan' => 'Total Rental Amount',
    'Deposit Produk' => 'Product Deposit',
    'Deposit' => 'Product Deposit',
    'Harga Produk' => 'Product / Market Price',
    'Harga Pasaran' => 'Market Price',
    'Harga Pasaran/Harga Produk' => 'Retail / Market Price',
    'Jumlah Tempoh Sewaan' => 'Total Rental Period',
    'Tempoh Sewaan' => 'Total Rental Period',

    # Device & Hardware
    'Nama Produk' => 'Product Name / Model',
    'Model Telefon' => 'Phone Model',
    'IMEI1' => 'IMEI 1 (Primary)',
    'IMEI2' => 'IMEI 2 (Secondary)',
    'imei1' => 'IMEI 1 (Primary)',
    'imei2' => 'IMEI 2 (Secondary)',
    'Nombor IMEI' => 'IMEI Number (IMEI1 / IMEI2)',
    'Nombor IMEI Telefon' => 'IMEI Number (IMEI1 / IMEI2)',
    'No IMEI' => 'IMEI Number',
    'IMEI' => 'IMEI Number',
    'Siri Telefon' => 'Serial Number',
    'No Siri' => 'Serial Number',
    'Serial Number' => 'Serial Number',
    'Nombor IMEI Telefon/ Siri Telefon' => 'IMEI / Serial Number',
    'Kuantiti Peralatan' => 'Equipment Quantity',
    'Kuantiti' => 'Equipment Quantity',

    # Customer & Recipient Details
    'Name' => 'Full Name / Recipient Name',
    'Nama' => 'Full Name / Recipient Name',
    'Nama Penerima' => 'Recipient Name',
    'Nama Penerima ("Pihak B")' => 'Recipient Name',
    'Full Name' => 'Full Name',
    'No Kad Pengenalan' => 'IC / MyKad Number',
    'No. Kad Pengenalan' => 'IC / MyKad Number',
    'No KP' => 'IC / MyKad Number',
    'No. KP' => 'IC / MyKad Number',
    'Nombor Kad Pengenalan' => 'IC / MyKad Number',
    'Nombor Telefon' => 'Recipient Phone Number',
    'Nombor Telefon ("Pihak B")' => 'Recipient Phone Number',
    'No Telefon' => 'Recipient Phone Number',
    'No. Tel' => 'Recipient Phone Number',
    'Phone Number' => 'Phone Number',
    'Email' => 'Recipient Email',
    'E-mel' => 'Recipient Email',
    'E-mel ("Pihak B")' => 'Recipient Email',
    'Emel' => 'Recipient Email',
    'Alamat Penghantaran' => 'Delivery Address',
    'Alamat Penghantaran ("Pihak B")' => 'Delivery Address',
    'Alamat' => 'Residential / Delivery Address',

    # Signatures
    'Tandatangan Penerima ("Pihak B")' => 'Recipient Signature',
    'Tandatangan Penerima' => 'Recipient Signature',
    'Tandatangan Pihak B' => 'Recipient Signature',
    'Tandatangan' => 'Signature',
    'Signature' => 'Signature'
  }.freeze

  FIELD_TO_ENGLISH_KEY = {
    'Day Of Date' => 'day_of_date',
    'Day of Date' => 'day_of_date',
    'Day of Agreement' => 'day_of_agreement',
    'Month Of Date' => 'month_of_date',
    'Month of Date' => 'month_of_date',
    'Month of Agreement' => 'month_of_agreement',
    'Year of Date' => 'year_of_date',
    'Year Of Date' => 'year_of_date',
    'Year of Agreement' => 'year_of_agreement',
    'Nombor Pesanan' => 'order_number',
    'Nama Penerima ("Pihak B")' => 'recipient_name',
    'Nombor Telefon ("Pihak B")' => 'recipient_phone',
    'Alamat Penghantaran ("Pihak B")' => 'delivery_address',
    'E-mel ("Pihak B")' => 'recipient_email',
    'Nama Produk' => 'product_name',
    'IMEI1' => 'imei1',
    'IMEI2' => 'imei2',
    'imei1' => 'imei1',
    'imei2' => 'imei2',
    'Nombor IMEI' => 'nombor_imei',
    'Nombor IMEI Telefon' => 'nombor_imei',
    'Siri Telefon' => 'serial_number',
    'Nombor IMEI Telefon/ Siri Telefon' => 'imei_and_serial',
    'Kuantiti Peralatan' => 'quantity',
    'Tarikh mula sewaan' => 'rental_start_date',
    'Tarikh akhir sewaan' => 'rental_end_date',
    'Jumlah Tempoh Sewaan' => 'rental_duration',
    'Harga Sewa Sebulan' => 'monthly_rent',
    'Jumlah Sewa' => 'total_rent',
    'Deposit Produk' => 'product_deposit',
    'Harga Produk' => 'product_price',
    'Harga Pasaran/Harga Produk' => 'retail_price',
    'Harga Pasaran' => 'market_price',
    'Tandatangan Penerima ("Pihak B")' => 'recipient_signature',
    'Tandatangan Penerima' => 'recipient_signature',
    'Nama' => 'signer_name',
    'Name' => 'signer_name',
    'No Kad Pengenalan' => 'ic_number',
    'No. Kad Pengenalan' => 'ic_number',
    'Date' => 'agreement_date',
    'Tarikh' => 'agreement_date',
    'Tarikh Penerimaan' => 'receipt_date',
    'Nombor Telefon' => 'recipient_phone',
    'Alamat Penghantaran' => 'delivery_address',
    'Email' => 'recipient_email',
    'Full Name' => 'full_name',
    'Phone Number' => 'phone_number',
    'Device Model' => 'device_model',
    'Rental Start Date' => 'rental_start_date',
    'Terms Accepted' => 'terms_accepted'
  }.freeze

  def translation_for(field_name, field_type = nil)
    name = field_name.to_s.strip

    if name.blank?
      return 'Recipient Signature' if field_type == 'signature'
      return 'Data Field'
    end

    # Check direct dictionary lookup
    trans = TRANSLATIONS[name]
    return trans if trans.present?

    # Normalized key lookup
    normalized = name.downcase.gsub(/["'()]/, '').gsub(/\s+/, ' ').strip

    TRANSLATIONS.each do |k, v|
      norm_k = k.downcase.gsub(/["'()]/, '').gsub(/\s+/, ' ').strip
      return v if normalized == norm_k
    end

    # Pattern / Keyword matching rules for any new or varied field names
    case normalized
    when /day.*date|haribulan|hari\b|day.*agreement|agreement.*day/i
      'Agreement Day (DD)'
    when /month.*date|bulan\b|month.*agreement|agreement.*month/i
      'Agreement Month (MM)'
    when /year.*date|tahun\b|year.*agreement|agreement.*year/i
      'Agreement Year (YYYY)'
    when /pesanan|order/i
      'Order Number'
    when /nama.*produk|model.*telefon|device.*model|product.*name/i
      'Product Name / Model'
    when /imei.*siri|siri.*imei/i
      'IMEI / Serial Number'
    when /imei\s*1\b/i
      'IMEI 1 (Primary)'
    when /imei\s*2\b/i
      'IMEI 2 (Secondary)'
    when /imei/i
      'IMEI Number'
    when /siri|serial/i
      'Serial Number'
    when /kuantiti|quantity/i
      'Equipment Quantity'
    when /tarikh.*mula|start.*date/i
      'Rental Start Date'
    when /tarikh.*akhir|end.*date/i
      'Rental End Date'
    when /tarikh.*terima|tarikh.*penerimaan|receipt.*date/i
      'Receipt Date'
    when /tarikh|date/i
      'Agreement / Signing Date'
    when /tempoh.*sewa|rental.*duration|rental.*period/i
      'Total Rental Period'
    when /sewa.*sebulan|monthly.*rent/i
      'Monthly Rental Price'
    when /jumlah.*sewa|total.*rent/i
      'Total Rental Amount'
    when /deposit/i
      'Product Deposit'
    when /harga.*produk|harga.*pasaran|retail.*price|market.*price/i
      'Product / Market Price'
    when /harga/i
      'Price / Amount'
    when /kad.*pengenalan|no.*kp|ic.*number|mykad|nric/i
      'IC / MyKad Number'
    when /telefon|phone|mobile|tel\b/i
      'Recipient Phone Number'
    when /alamat.*hantar|delivery.*address/i
      'Delivery Address'
    when /alamat|address/i
      'Residential / Delivery Address'
    when /e-?mel|email/i
      'Recipient Email'
    when /tandatangan|signature/i
      'Recipient Signature'
    when /nama.*penerima|recipient.*name/i
      'Recipient Name'
    when /nama.*penuh|full.*name|nama\b|name\b/i
      'Full Name / Recipient Name'
    when /saksi/i
      'Witness'
    else
      if field_type == 'signature'
        'Recipient Signature'
      elsif field_type == 'date'
        'Date'
      elsif field_type == 'phone'
        'Phone Number'
      elsif field_type == 'email'
        'Email Address'
      else
        name.titleize
      end
    end
  end

  def processed_data_field?(field_name, field_type = nil)
    return false if field_type == 'signature'

    name = field_name.to_s.strip
    normalized = name.downcase.gsub(/["'()]/, '').gsub(/\s+/, ' ').strip

    # Rental Start / End Dates
    return true if normalized =~ /\b(tarikh\s+mula|tarikh\s+akhir|start\s+date|end\s+date)\b/i

    # Jumlah Tempoh Sewaan = Period - 1 (PROCESSED DATA)
    return true if normalized =~ /\b(jumlah\s+tempoh\s+sewaan|tempoh\s+sewaan|rental\s+duration|rental\s+period)\b/i

    # Nombor Pesanan / Order Number
    return true if normalized =~ /\b(pesanan|order)\b/i

    # Jumlah Sewa (Total Rent) = Harga Sewa Sebulan * Jumlah Tempoh Sewaan
    return true if normalized =~ /\b(jumlah\s+sewa|jumlah\s+sewaan|total\s+rent)\b/i

    # Nombor IMEI = "IMEI1 / IMEI2" or "IMEI1 / -" (PROCESSED DATA)
    return true if normalized =~ /\b(nombor\s+imei|no\s+imei|imei\s+number|imei)\b/i && normalized !~ /\b(imei\s*1|imei\s*2|imei1|imei2)\b/i

    # Date-related: explicit agreement date, tarikh, haribulan, or standalone day/month/year/hari/bulan/tahun
    return true if normalized =~ /\b(date|tarikh|haribulan)\b/i
    return true if normalized =~ /\b(day|month|year|hari|bulan|tahun)\b/i

    false
  end

  def calculate_nombor_imei(fields_hash = {})
    return nil if fields_hash.blank?

    imei1 = fields_hash['imei1'] || fields_hash['IMEI1'] || fields_hash['imei_1'] || fields_hash['primary_imei'] || fields_hash['imei']
    imei2 = fields_hash['imei2'] || fields_hash['IMEI2'] || fields_hash['imei_2'] || fields_hash['secondary_imei']

    # If imei1 is already in combined format (e.g. "358701814261211 / 358701818872716" or contains "/")
    if imei1.to_s.include?('/')
      return imei1.to_s.strip
    end

    imei1_str = imei1.to_s.gsub(/[^0-9]/, '').strip
    imei2_str = imei2.to_s.gsub(/[^0-9]/, '').strip

    if imei1_str.present? && imei2_str.present?
      "#{imei1_str} / #{imei2_str}"
    elsif imei1_str.present?
      "#{imei1_str} / -"
    elsif imei2_str.present?
      "- / #{imei2_str}"
    elsif imei1.present?
      "#{imei1.to_s.strip} / -"
    else
      nil
    end
  end

  def calculate_jumlah_tempoh_sewaan(fields_hash = {})
    return nil if fields_hash.blank?

    raw_val = fields_hash['calculator_period'] || fields_hash['period'] || fields_hash['Period'] ||
              fields_hash['tempoh'] || fields_hash['Tempoh'] || fields_hash['tempoh_sewaan'] ||
              fields_hash['Jumlah Tempoh Sewaan'] || fields_hash['rental_period'] || fields_hash['rental_duration']

    if raw_val.blank?
      # Deep scan across all fields_hash values for period patterns (e.g. "13Period", "Period: 13Period", "13 Months")
      fields_hash.each do |_k, v|
        next if v.blank? || !v.is_a?(String)
        if v =~ /(?:period[:\s]*|tempoh[:\s]*|^)\s*(\d+)\s*(?:period|bulan|months?)/i || v =~ /period[:\s]+(\d+)/i
          raw_val = Regexp.last_match(1)
          break
        end
      end
    end

    return nil if raw_val.blank?

    match = raw_val.to_s.match(/(\d+)/)
    return nil unless match

    num = match[1].to_i
    num > 1 ? (num - 1).to_s : num.to_s
  end

  def calculate_tarikh_akhir_sewaan(fields_hash = {}, now: Time.current)
    duration_val = fields_hash['Jumlah Tempoh Sewaan'] || fields_hash['rental_duration'] || fields_hash['tempoh_sewaan'] ||
                   calculate_jumlah_tempoh_sewaan(fields_hash)

    return nil if duration_val.blank?

    months = duration_val.to_s.gsub(/[^0-9]/, '').to_i
    return nil if months <= 0

    (now + months.months).strftime('%d-%m-%Y')
  end

  def calculate_jumlah_sewa(fields_hash = {})
    return nil if fields_hash.blank?

    hs_raw = fields_hash['Harga Sewa Sebulan'] || fields_hash['monthly_rent'] || fields_hash['monthly_rental_price'] ||
             fields_hash['rent'] || fields_hash['sewa_sebulan'] || fields_hash['harga_sewa'] || fields_hash['harga_sewa_bulanan']

    duration_val = fields_hash['Jumlah Tempoh Sewaan'] || fields_hash['rental_duration'] || fields_hash['tempoh_sewaan'] ||
                   calculate_jumlah_tempoh_sewaan(fields_hash)

    hs = hs_raw.to_s.gsub(/[^0-9.]/, '').to_f
    duration = duration_val.to_s.gsub(/[^0-9.]/, '').to_f

    if hs > 0 && duration > 0
      total = hs * duration
      (total % 1).zero? ? total.to_i.to_s : sprintf('%.2f', total)
    else
      nil
    end
  end

  def processed_data_value(field_name, field_type = nil, account: nil, order_number: nil, now: Time.current, fields_hash: {})
    name = field_name.to_s.strip
    normalized = name.downcase.gsub(/["'()]/, '').gsub(/\s+/, ' ').strip

    # 1. Day of Date (e.g. 22)
    if normalized =~ /\b(day\s+of\s+date|haribulan|hari)\b/i || (normalized =~ /\bday\b/i && normalized !~ /\b(month|year|birth)\b/i)
      now.strftime('%d')
    # 2. Month of Date (e.g. 01)
    elsif normalized =~ /\b(month\s+of\s+date|bulan)\b/i || (normalized =~ /\bmonth\b/i && normalized !~ /\b(day|year|rent)\b/i)
      now.strftime('%m')
    # 3. Year of Date (e.g. 26)
    elsif normalized =~ /\b(year\s+of\s+date|tahun)\b/i || (normalized =~ /\byear\b/i && normalized !~ /\b(day|month)\b/i)
      now.strftime('%y')
    # 4. Order Number (e.g. 2026012200)
    elsif normalized =~ /\b(pesanan|order)\b/i
      order_number.presence || DailyOrderSequence.next_order_number(account, date: now)
    # 5. Jumlah Tempoh Sewaan = Period - 1 (e.g. 13Period -> 12)
    elsif normalized =~ /\b(jumlah\s+tempoh\s+sewaan|tempoh\s+sewaan|rental\s+duration|rental\s+period)\b/i
      calculate_jumlah_tempoh_sewaan(fields_hash || {})
    # 6. Tarikh mula sewaan = Today's Date (e.g. 15-08-2026)
    elsif normalized =~ /\b(tarikh\s+mula\s+sewaan|tarikh\s+mula|rental\s+start\s+date|start\s+date)\b/i
      now.strftime('%d-%m-%Y')
    # 7. Tarikh akhir sewaan = Today's Date + X months (e.g. 15-08-2027)
    elsif normalized =~ /\b(tarikh\s+akhir\s+sewaan|tarikh\s+akhir|rental\s+end\s+date|end\s+date)\b/i
      calculate_tarikh_akhir_sewaan(fields_hash || {}, now: now)
    # 8. Jumlah Sewa = Harga Sewa Sebulan * Jumlah Tempoh Sewaan
    elsif normalized =~ /\b(jumlah\s+sewa|jumlah\s+sewaan|total\s+rent)\b/i
      calculate_jumlah_sewa(fields_hash || {})
    # 9. Nombor IMEI = "IMEI1 / IMEI2" or "IMEI1 / -"
    elsif normalized =~ /\b(nombor\s+imei|no\s+imei|imei\s+number|imei)\b/i && normalized !~ /\b(imei\s*1|imei\s*2|imei1|imei2)\b/i
      calculate_nombor_imei(fields_hash || {})
    # 10. Agreement Date (e.g. 15-08-2026)
    elsif normalized =~ /\b(date|tarikh)\b/i || field_type.to_s == 'date'
      now.strftime('%d-%m-%Y')
    else
      nil
    end
  end

  def populate_processed_fields!(fields_hash, template_fields, template_submitters, normalized_submitters, english_fields, account: nil, now: Time.current)
    allocated_order_number = nil

    # Allocate order number once per document submission if an order field exists
    has_order_field = template_fields.any? { |f| processed_data_field?(f['name'], f['type']) && f['name'].to_s.downcase =~ /\b(pesanan|order)\b/i }
    if has_order_field
      allocated_order_number = DailyOrderSequence.next_order_number(account, date: now)
    end

    # IMPORTANT: Process fields in dependency order.
    # Jumlah Tempoh Sewaan must be computed FIRST because Tarikh akhir sewaan and Jumlah Sewa depend on it.
    processed = template_fields.select { |f| processed_data_field?(f['name'], f['type']) }

    # Sort: Jumlah Tempoh Sewaan first, then rental dates/sewa/imei, then everything else
    sorted_processed = processed.sort_by do |f|
      normalized = f['name'].to_s.downcase
      if normalized =~ /tempoh/
        0  # Jumlah Tempoh Sewaan first
      elsif normalized =~ /(mula|akhir|jumlah\s+sewa|imei)/
        1  # Dependent fields second
      else
        2  # Everything else (dates, order number)
      end
    end

    sorted_processed.each do |f|
      f_name = f['name']
      f_type = f['type']

      calc_val = processed_data_value(f_name, f_type, account: account, order_number: allocated_order_number, now: now, fields_hash: fields_hash)
      next if calc_val.blank?

      fields_hash[f_name] = calc_val
      en_key = english_key_for(f_name)
      english_fields[en_key] = calc_val

      # Populate into matching submitter values
      normalized_submitters.each do |sub|
        if sub['uuid'] == f['submitter_uuid'] || f['submitter_uuid'].blank?
          sub['values'] ||= {}
          sub['values'][f_name] = calc_val
        end
      end
    end
  end

  def english_key_for(field_name)
    FIELD_TO_ENGLISH_KEY[field_name] || field_name.to_s.parameterize.underscore
  end

  def parse_ai_response(response_json, template, account = nil)
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

    raw_fields = parsed_data['fields'] || {}

    # Build bidirectional lookup (Malay field name <-> English key)
    fields_hash = {}
    english_fields = {}

    template_fields.each do |f|
      f_name = f['name']
      en_key = english_key_for(f_name)

      # Direct and standard key matching
      val = raw_fields[f_name] || raw_fields[en_key] || raw_fields[en_key.camelize] || raw_fields[f_name.parameterize.underscore]

      # Robust synonym & alias matching for raw data fields
      if val.blank?
        case f_name
        when 'Harga Sewa Sebulan'
          val = raw_fields['monthly_rent'] || raw_fields['monthly_rental_price'] || raw_fields['monthly_rental'] || raw_fields['rent'] || raw_fields['sewa_sebulan'] || raw_fields['harga_sewa'] || raw_fields['harga_sewa_bulanan']
        when 'Deposit Produk'
          val = raw_fields['product_deposit'] || raw_fields['deposit'] || raw_fields['deposit_amount'] || raw_fields['deposit_produk'] || raw_fields['deposit_sewa']
        when 'Harga Produk'
          val = raw_fields['product_price'] || raw_fields['retail_price'] || raw_fields['market_price'] || raw_fields['harga_pasaran'] || raw_fields['harga_produk'] || raw_fields['price'] || raw_fields['harga']
        when 'Nama Produk'
          val = raw_fields['product_name'] || raw_fields['device_model'] || raw_fields['model'] || raw_fields['nama_produk']
        when 'Nombor IMEI'
          val = raw_fields['imei_number'] || raw_fields['imei'] || raw_fields['nombor_imei']
        when 'Nombor Telefon'
          val = raw_fields['phone_number'] || raw_fields['phone'] || raw_fields['mobile'] || raw_fields['nombor_telefon'] || raw_fields['no_tel']
        when 'Alamat Penghantaran'
          val = raw_fields['delivery_address'] || raw_fields['address'] || raw_fields['alamat'] || raw_fields['alamat_penghantaran']
        when 'Email'
          val = raw_fields['recipient_email'] || raw_fields['email'] || raw_fields['e_mel'] || raw_fields['emel']
        when 'No Kad Pengenalan'
          val = raw_fields['ic_number'] || raw_fields['ic'] || raw_fields['mykad'] || raw_fields['nric'] || raw_fields['no_kp'] || raw_fields['no_kad_pengenalan']
        when 'Name'
          val = raw_fields['full_name'] || raw_fields['recipient_name'] || raw_fields['name'] || raw_fields['nama'] || raw_fields['nama_penerima']
        end
      end

      if val.blank? && parsed_data['submitters'].present?
        parsed_data['submitters'].each do |sub_d|
          s_vals = sub_d['values'] || {}
          v = s_vals[f_name] || s_vals[en_key] || s_vals[en_key.camelize]
          if v.present?
            val = v
            break
          end
        end
      end

      if val.present?
        fields_hash[f_name] = val
        english_fields[en_key] = val
      end
    end

    # Also capture any extra extracted fields
    raw_fields.each do |k, v|
      en_k = english_key_for(k)
      english_fields[en_k] ||= v
      fields_hash[k] ||= v
    end

    # Explicitly capture imei1 and imei2 from root fields or scan
    raw_imei1 = raw_fields['imei1'] || raw_fields['IMEI1'] || raw_fields['imei_1'] || raw_fields['primary_imei']
    raw_imei2 = raw_fields['imei2'] || raw_fields['IMEI2'] || raw_fields['imei_2'] || raw_fields['secondary_imei']

    # If raw single imei provided containing two IMEIs (e.g. separated by slash or newline), parse them out
    if raw_imei1.blank? && (raw_fields['imei'].present? || raw_fields['imei_number'].present? || raw_fields['nombor_imei'].present?)
      combined_imei = raw_fields['imei'] || raw_fields['imei_number'] || raw_fields['nombor_imei']
      if combined_imei.to_s =~ /(\d{14,16})[^\d]+(\d{14,16})/
        raw_imei1 = Regexp.last_match(1)
        raw_imei2 = Regexp.last_match(2)
      else
        raw_imei1 = combined_imei.to_s.gsub(/[^0-9]/, '').strip
      end
    end

    if raw_imei1.present?
      fields_hash['imei1'] = raw_imei1
      english_fields['imei1'] = raw_imei1
    end
    if raw_imei2.present?
      fields_hash['imei2'] = raw_imei2
      english_fields['imei2'] = raw_imei2
    end

    # Explicitly capture branch_name from root fields, AI fields, or regex scan
    raw_branch_name = raw_fields['branch_name'] || raw_fields['Branch Name'] || raw_fields['branch'] || raw_fields['cawangan'] || raw_fields['nama_cawangan'] || parsed_data.dig('fields', 'branch_name')
    if raw_branch_name.blank? && content =~ /(?:\(\d+\)\s*)?(?:branch(?:\s*name)?|cawangan(?:\s*name)?|nama\s*cawangan)\s*[:=\-]\s*([^\r\n,]+)/i
      raw_branch_name = Regexp.last_match(1).to_s.strip
    end
    if raw_branch_name.present?
      fields_hash['branch_name'] = raw_branch_name
      english_fields['branch_name'] = raw_branch_name
    end

    # Explicitly capture calculator_period from root response or regex scan
    calc_p = parsed_data['calculator_period'] || parsed_data['period'] || parsed_data['tempoh']
    if calc_p.blank? && content =~ /(?:period[:\s]*|tempoh[:\s]*)\s*(\d+)\s*(?:period|bulan|months?)?/i
      calc_p = Regexp.last_match(1)
    end
    if calc_p.present?
      fields_hash['calculator_period'] ||= calc_p
      fields_hash['period'] ||= calc_p
      english_fields['calculator_period'] ||= calc_p
    end

    normalized_submitters = template_submitters.map do |ts|
      s_data = submitters_map[ts['uuid']] || {}
      s_values = s_data['values'] || {}

      # Assign any field values that belong to this submitter
      template_fields.select { |f| f['submitter_uuid'] == ts['uuid'] }.each do |f|
        f_name = f['name']
        en_key = english_key_for(f_name)
        if fields_hash.key?(f_name) && !s_values.key?(f_name)
          s_values[f_name] = fields_hash[f_name]
        elsif s_values.key?(f_name) && !fields_hash.key?(f_name)
          fields_hash[f_name] = s_values[f_name]
          english_fields[en_key] = s_values[f_name]
        elsif s_values.key?(en_key) && !s_values.key?(f_name)
          s_values[f_name] = s_values[en_key]
          fields_hash[f_name] = s_values[en_key]
          english_fields[en_key] = s_values[en_key]
        end
      end

      # Extract email, name, phone from fields if not in submitter root
      sub_email = s_data['email'].presence || fields_hash['E-mel ("Pihak B")'].presence || english_fields['recipient_email'].presence || ''
      sub_name = s_data['name'].presence || fields_hash['Nama Penerima ("Pihak B")'].presence || english_fields['recipient_name'].presence || ''
      sub_phone = s_data['phone'].presence || fields_hash['Nombor Telefon ("Pihak B")'].presence || english_fields['recipient_phone'].presence || ''

      if raw_branch_name.present?
        s_values['branch_name'] = raw_branch_name
      end

      {
        'uuid' => ts['uuid'],
        'role' => ts['name'],
        'name' => sub_name,
        'email' => sub_email,
        'phone' => sub_phone,
        'values' => s_values
      }
    end

    # Auto-populate hardcoded Processed Data Fields (Dates & Daily Incremental Order Number)
    populate_processed_fields!(fields_hash, template_fields, template_submitters, normalized_submitters, english_fields, account: account)

    first_sub = normalized_submitters.first || {}

    # Clean English JSON Output
    english_output_json = {
      'summary' => parsed_data['summary'] || 'Data extracted successfully.',
      'recipient' => {
        'name' => first_sub['name'].to_s,
        'email' => first_sub['email'].to_s,
        'phone' => first_sub['phone'].to_s
      },
      'fields' => english_fields
    }

    {
      success: true,
      summary: parsed_data['summary'] || 'Data extracted successfully.',
      submitters: normalized_submitters,
      fields: fields_hash,
      english_fields: english_fields,
      raw_json: english_output_json
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

