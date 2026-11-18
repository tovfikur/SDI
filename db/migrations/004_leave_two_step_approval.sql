-- ============================================================================
-- 2-Step Leave Approval (Spec 3.1)
-- Manager step keeps application 'pending' and sets approval_step=2;
-- HR step consumes balance and marks it 'approved'.
-- ============================================================================

ALTER TABLE leave_applications
  ADD COLUMN approval_step smallint NOT NULL DEFAULT 1
  CHECK (approval_step IN (1, 2));

-- Existing approved applications are treated as fully approved (step 2).
UPDATE leave_applications SET approval_step = 2 WHERE status = 'approved';
