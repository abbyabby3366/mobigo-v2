# frozen_string_literal: true

Rails.application.config.after_initialize do
  Account.where(timezone: ['UTC', nil, '']).update_all(timezone: 'Singapore') rescue nil
end
