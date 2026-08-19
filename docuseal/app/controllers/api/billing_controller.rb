# frozen_string_literal: true

module Api
  class BillingController < ApiBaseController
    before_action do
      authorize!(:manage, current_user.account)
    end

    def show
      account = current_user.account

      render json: {
        account_id: account.id,
        account_name: account.name,
        balance: Billing.balance(account),
        currency: 'USD',
        rate_per_signature: Billing::PRICE_PER_SIGNATURE,
        total_completed_signatures: Billing.total_completed_signatures(account),
        total_spent: Billing.total_spent(account),
        this_month_completed_signatures: Billing.month_completed_signatures(account),
        this_month_spent: Billing.month_spent(account)
      }
    end

    def create
      account = current_user.account

      # If invoices array or single invoice is passed, save them directly to database
      if params[:invoices].present? || params[:invoice].present?
        invoices_data = params[:invoices].is_a?(Array) ? params[:invoices] : [params[:invoice] || params[:invoices]]
        existing_records = Billing.invoice_records(account)
        existing_ids = existing_records.map { |r| r['id'] }.to_set

        invoices_data.each do |inv|
          inv_hash = inv.is_a?(ActionController::Parameters) ? inv.permit!.to_h : inv.to_h
          inv_hash = inv_hash.stringify_keys

          inv_hash['id'] ||= "INV-#{Time.current.strftime('%Y%m%d')}-#{SecureRandom.hex(3).upcase}"
          inv_hash['date'] ||= Time.current.iso8601
          inv_hash['amount'] = inv_hash['amount'].to_f.round(2)
          inv_hash['currency'] ||= 'USD'
          inv_hash['status'] ||= 'Paid'
          inv_hash['payment_method'] ||= 'API'
          inv_hash['description'] ||= 'eSignature API Credit Top-Up'
          inv_hash['account_name'] ||= account.name
          inv_hash['user_email'] ||= current_user.email

          if existing_ids.include?(inv_hash['id'])
            existing_records = existing_records.map { |r| r['id'] == inv_hash['id'] ? inv_hash : r }
          else
            existing_records.unshift(inv_hash)
            existing_ids.add(inv_hash['id'])
          end
        end

        Billing.save_invoice_records(account, existing_records)

        return render json: {
          success: true,
          message: "Successfully saved #{invoices_data.size} invoice(s) to database.",
          account_id: account.id,
          total_invoices: existing_records.size,
          invoices: existing_records
        }
      end

      # If AI credits top-up is requested
      if params[:ai_credits].present? || params[:type].to_s == 'ai_credits'
        credits_count = (params[:ai_credits] || params[:credits]).to_i
        usd_amount = params[:amount].present? ? params[:amount].to_f.round(2) : AiCredit.credits_to_usd(credits_count)
        desc = params[:description].presence || "#{credits_count} AI credits"

        result = AiCredit.top_up!(
          account,
          credits: credits_count,
          usd: usd_amount,
          method: params[:method].presence || 'API',
          user: current_user,
          description: desc,
          reference: params[:reference],
          date: params[:date]
        )

        return render json: {
          success: true,
          message: "Successfully added #{credits_count} AI credits ($#{sprintf('%.2f', usd_amount)} USD)",
          account_id: account.id,
          credits_added: credits_count,
          amount_added: usd_amount,
          new_ai_balance: result[:new_balance],
          invoice_id: result[:invoice_id],
          currency: 'USD'
        }
      end

      # If explicit balance or action == 'set' is provided, set exact balance directly
      if params[:balance].present? || params[:action].to_s == 'set'
        target_balance = (params[:balance] || params[:amount]).to_f.round(2)
        if target_balance < 0
          return render json: { error: 'Balance cannot be negative.' }, status: :unprocessable_content
        end

        previous_balance = Billing.balance(account)
        Billing.set_balance(account, target_balance)
        diff = (target_balance - previous_balance).round(2)

        invoice = if diff > 0
                    Billing.record_invoice!(
                      account,
                      amount: diff,
                      method: 'API',
                      description: params[:description].presence || 'API Balance Adjustment (Credit)',
                      user: current_user,
                      reference: params[:reference],
                      previous_balance: previous_balance,
                      new_balance: target_balance
                    )
                  end

        return render json: {
          success: true,
          message: "Successfully set balance to $#{sprintf('%.2f', target_balance)} USD",
          account_id: account.id,
          previous_balance: previous_balance,
          new_balance: target_balance,
          difference: diff,
          invoice_id: invoice ? invoice['id'] : nil,
          currency: 'USD'
        }
      end

      # Otherwise treat as top-up / deduction amount
      amount = params[:amount].to_f
      if amount == 0
        return render json: { error: 'Invalid amount. Provide a non-zero amount to add/deduct or balance to set.' },
                      status: :unprocessable_content
      end

      if amount > 0
        result = Billing.top_up!(
          account,
          amount,
          method: 'API',
          description: params[:description].presence || 'API Balance Top-Up',
          user: current_user,
          reference: params[:reference]
        )

        render json: {
          success: true,
          message: "Successfully topped up $#{sprintf('%.2f', result[:amount_added])} USD",
          account_id: account.id,
          amount_added: result[:amount_added],
          previous_balance: result[:previous_balance],
          new_balance: result[:new_balance],
          invoice_id: result[:invoice_id],
          currency: 'USD'
        }
      else
        previous_balance = Billing.balance(account)
        new_balance = (previous_balance + amount).round(2)

        if new_balance < 0
          return render json: { error: "Insufficient balance for deduction. Current balance is $#{sprintf('%.2f', previous_balance)} USD." },
                        status: :unprocessable_content
        end

        Billing.set_balance(account, new_balance)

        render json: {
          success: true,
          message: "Successfully deducted $#{sprintf('%.2f', amount.abs)} USD",
          account_id: account.id,
          amount_deducted: amount.abs,
          previous_balance: previous_balance,
          new_balance: new_balance,
          currency: 'USD'
        }
      end
    rescue ArgumentError => e
      render json: { error: e.message }, status: :unprocessable_content
    end

    def update
      account = current_user.account

      if params[:balance].nil? && params[:amount].nil?
        return render json: { error: 'Please provide balance (e.g. {"balance": 50.00}) or amount to update.' },
                      status: :unprocessable_content
      end

      previous_balance = Billing.balance(account)
      target_balance = (params[:balance] || params[:amount]).to_f.round(2)

      if target_balance < 0
        return render json: { error: 'Balance cannot be negative.' }, status: :unprocessable_content
      end

      Billing.set_balance(account, target_balance)
      diff = (target_balance - previous_balance).round(2)

      invoice = if diff > 0
                  Billing.record_invoice!(
                    account,
                    amount: diff,
                    method: 'API',
                    description: params[:description].presence || 'API Balance Adjustment (Credit)',
                    user: current_user,
                    reference: params[:reference],
                    previous_balance: previous_balance,
                    new_balance: target_balance
                  )
                end

      render json: {
        success: true,
        message: "Successfully updated balance to $#{sprintf('%.2f', target_balance)} USD",
        account_id: account.id,
        previous_balance: previous_balance,
        new_balance: target_balance,
        difference: diff,
        invoice_id: invoice ? invoice['id'] : nil,
        currency: 'USD'
      }
    rescue ArgumentError => e
      render json: { error: e.message }, status: :unprocessable_content
    end
  end
end
