CREATE TABLE loan_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  installment_no integer NOT NULL,
  due_date date NOT NULL,
  amount numeric(12,2) NOT NULL,
  principal_component numeric(12,2) DEFAULT 0,
  interest_component numeric(12,2) DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','overdue')),
  paid_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);