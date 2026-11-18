ALTER TABLE loans ADD COLUMN IF NOT EXISTS installment_mode text CHECK (installment_mode IN ('count','amount')) DEFAULT 'count';
ALTER TABLE loans ADD COLUMN IF NOT EXISTS installment_count integer CHECK (installment_count >= 1);
ALTER TABLE loans ADD COLUMN IF NOT EXISTS monthly_installment_amount numeric(12,2) DEFAULT 0;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS deduction_day integer CHECK (deduction_day BETWEEN 1 AND 31);
ALTER TABLE loans ADD COLUMN IF NOT EXISTS interest_amount numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS total_payable numeric(12,2) NOT NULL DEFAULT 0;