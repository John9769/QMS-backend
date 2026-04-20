-- ============================================
-- QMS — QUEUE MANAGEMENT SYSTEM
-- FINAL SCHEMA v2.0
-- Multi-tenant | Govt + Private Hospitals
-- Author: Pian (github.com/John9769)
-- Algorithm: Presence-Based Auto-Skip Queue
-- Parallel Counter + Clinic Workflow
-- ============================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- 1. TENANTS
-- ============================================
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(10) NOT NULL CHECK (type IN ('GOVT', 'PRIVATE')),
  address TEXT NOT NULL,
  city VARCHAR(100),
  state VARCHAR(100),
  postcode VARCHAR(10),
  phone VARCHAR(20),
  email VARCHAR(255),
  lat DECIMAL(10, 7),
  lng DECIMAL(10, 7),
  -- Pricing (set during onboarding, adjustable)
  s_series_fee DECIMAL(10, 2) NOT NULL DEFAULT 6.00,
  a_series_fee DECIMAL(10, 2) NOT NULL DEFAULT 4.00,
  hospital_rebate DECIMAL(10, 2) NOT NULL DEFAULT 1.00,
  -- EMR type for staff awareness
  emr_type VARCHAR(10) DEFAULT 'MANUAL'
    CHECK (emr_type IN ('MANUAL', 'DIGITAL', 'HYBRID')),
  is_active BOOLEAN DEFAULT true,
  onboarded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_tenants_type ON tenants(type);
CREATE INDEX idx_tenants_state ON tenants(state);
CREATE INDEX idx_tenants_active ON tenants(is_active);

-- ============================================
-- 2. DEPARTMENTS
-- ============================================
CREATE TABLE departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  s_quota_per_day INTEGER NOT NULL DEFAULT 20,
  avg_minutes_per_patient INTEGER NOT NULL DEFAULT 20,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_departments_tenant ON departments(tenant_id);
CREATE INDEX idx_departments_active ON departments(is_active);

-- ============================================
-- 3. OPERATION HOURS (Per department per day)
-- ============================================
CREATE TABLE operation_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  day_of_week VARCHAR(3) NOT NULL
    CHECK (day_of_week IN ('MON','TUE','WED','THU','FRI','SAT','SUN')),
  open_time TIME NOT NULL,
  close_time TIME NOT NULL,
  lunch_start TIME,
  lunch_end TIME,
  is_closed BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(department_id, day_of_week)
);
CREATE INDEX idx_ophours_dept ON operation_hours(department_id);

-- ============================================
-- 4. USERS (Staff only — nurses, counter, matron, admin)
-- Patients are NOT users. They are patient_profiles.
-- ============================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(20) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(15) NOT NULL CHECK (role IN ('SUPER_ADMIN', 'STAFF')),
  is_active BOOLEAN DEFAULT true,
  last_login_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- ============================================
-- 5. STAFF ASSIGNMENTS
-- sub_role: COUNTER (Cik Ida) | NURSE (Ms Goh) |
--           MATRON | MANAGER | ADMIN
-- ============================================
CREATE TABLE staff_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id) ON DELETE CASCADE,
  sub_role VARCHAR(10) NOT NULL
    CHECK (sub_role IN ('COUNTER','NURSE','MATRON','MANAGER','ADMIN')),
  is_active BOOLEAN DEFAULT true,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, department_id, sub_role)
);
CREATE INDEX idx_staff_user ON staff_assignments(user_id);
CREATE INDEX idx_staff_tenant ON staff_assignments(tenant_id);
CREATE INDEX idx_staff_dept ON staff_assignments(department_id);
CREATE INDEX idx_staff_subrole ON staff_assignments(sub_role);

-- ============================================
-- 6. PATIENT PROFILES
-- No login. Identified by name + ic_last4 + phone.
-- is_verified = verified at registration counter.
-- ============================================
CREATE TABLE patient_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(255) NOT NULL,
  ic_last4 VARCHAR(4) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  -- Verification tracking
  is_verified BOOLEAN DEFAULT false,
  verified_at TIMESTAMP,
  verified_at_tenant_id UUID REFERENCES tenants(id),
  verified_by UUID REFERENCES users(id),
  -- Soft delete for PDPA
  deletion_requested_at TIMESTAMP,
  deleted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(ic_last4, phone)
);
CREATE INDEX idx_patient_ic4 ON patient_profiles(ic_last4);
CREATE INDEX idx_patient_phone ON patient_profiles(phone);
CREATE INDEX idx_patient_verified ON patient_profiles(is_verified);

-- ============================================
-- 7. QUEUE SESSIONS (One per department per day)
-- ============================================
CREATE TABLE queue_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_date DATE NOT NULL,
  -- S series counters
  s_last_ticket_number INTEGER DEFAULT 0,
  s_total_booked INTEGER DEFAULT 0,
  s_total_served INTEGER DEFAULT 0,
  s_total_forfeited INTEGER DEFAULT 0,
  -- W series counters
  w_last_ticket_number INTEGER DEFAULT 0,
  w_total_served INTEGER DEFAULT 0,
  -- A series counters
  a_last_ticket_number INTEGER DEFAULT 0,
  a_total_booked INTEGER DEFAULT 0,
  a_total_served INTEGER DEFAULT 0,
  -- Session state
  is_open BOOLEAN DEFAULT false,
  opened_at TIMESTAMP,
  closed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(department_id, session_date)
);
CREATE INDEX idx_sessions_dept ON queue_sessions(department_id);
CREATE INDEX idx_sessions_date ON queue_sessions(session_date);
CREATE INDEX idx_sessions_tenant ON queue_sessions(tenant_id);
CREATE INDEX idx_sessions_open ON queue_sessions(is_open);

-- ============================================
-- 8. QUEUE TICKETS
-- Core table. One per patient per department visit.
-- series: S (self-book) | W (walk-in) | A (appointment)
-- ============================================
CREATE TABLE queue_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES queue_sessions(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES patient_profiles(id) ON DELETE SET NULL,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Ticket identity
  series VARCHAR(1) NOT NULL CHECK (series IN ('S','W','A')),
  ticket_number INTEGER NOT NULL,
  ticket_code VARCHAR(10) NOT NULL,       -- S0004, W0012, A0003
  -- Patient visit type
  is_first_visit BOOLEAN DEFAULT false,
  -- Verification flow (Cik Ida + Ms Goh parallel)
  verification_status VARCHAR(10) DEFAULT 'NA'
    CHECK (verification_status IN (
      'NA',        -- existing patient, EMR pull by counter
      'PENDING',   -- new patient, counter creating EMR
      'VERIFIED',  -- counter verified, EMR created
      'EMR_READY'  -- EMR physically passed to clinic, nurse can call
    )),
  verified_by UUID REFERENCES users(id),
  verified_at TIMESTAMP,
  emr_ready_by UUID REFERENCES users(id),
  emr_ready_at TIMESTAMP,
  -- Ticket lifecycle status
  status VARCHAR(10) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN (
      'PENDING',    -- booked, not arrived
      'ARRIVED',    -- geofence triggered
      'CALLED',     -- nurse called patient
      'SERVED',     -- consultation done
      'FORFEITED'   -- judge timeout or manual
    )),
  -- S + A series GPS + ETA fields
  origin_lat DECIMAL(10, 7),
  origin_lng DECIMAL(10, 7),
  driving_minutes INTEGER,
  eta TIMESTAMP,
  eta_deadline TIMESTAMP,
  -- A series specific
  is_appointment BOOLEAN DEFAULT false,
  appointment_date DATE,
  appointment_keyed_by UUID REFERENCES users(id),
  -- Geofence
  geofence_triggered_at TIMESTAMP,
  geofence_lat DECIMAL(10, 7),
  geofence_lng DECIMAL(10, 7),
  geofence_distance_meters INTEGER,
  -- Lifecycle timestamps
  called_at TIMESTAMP,
  served_at TIMESTAMP,
  forfeited_at TIMESTAMP,
  forfeited_reason VARCHAR(15)
    CHECK (forfeited_reason IN ('JUDGE_TIMEOUT','MANUAL')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(session_id, series, ticket_number)
);
CREATE INDEX idx_tickets_session ON queue_tickets(session_id);
CREATE INDEX idx_tickets_patient ON queue_tickets(patient_id);
CREATE INDEX idx_tickets_status ON queue_tickets(status);
CREATE INDEX idx_tickets_series ON queue_tickets(series);
CREATE INDEX idx_tickets_dept ON queue_tickets(department_id);
CREATE INDEX idx_tickets_eta ON queue_tickets(eta_deadline);
CREATE INDEX idx_tickets_verification ON queue_tickets(verification_status);
CREATE INDEX idx_tickets_first_visit ON queue_tickets(is_first_visit);

-- ============================================
-- 9. BOOKINGS (S + A series detail snapshot)
-- ============================================
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES queue_tickets(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patient_profiles(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_date DATE NOT NULL,
  -- GPS snapshot at time of booking
  origin_lat DECIMAL(10, 7),
  origin_lng DECIMAL(10, 7),
  hospital_lat DECIMAL(10, 7) NOT NULL,
  hospital_lng DECIMAL(10, 7) NOT NULL,
  distance_km DECIMAL(8, 2),
  driving_minutes INTEGER,
  assumed_speed_kmh INTEGER DEFAULT 80,
  eta TIMESTAMP,
  eta_deadline TIMESTAMP,
  -- A series
  is_appointment BOOLEAN DEFAULT false,
  appointment_instructed_date DATE,
  keyed_by UUID REFERENCES users(id),
  status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','COMPLETED','FORFEITED')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_bookings_ticket ON bookings(ticket_id);
CREATE INDEX idx_bookings_patient ON bookings(patient_id);
CREATE INDEX idx_bookings_date ON bookings(booking_date);
CREATE INDEX idx_bookings_status ON bookings(status);

-- ============================================
-- 10. PAYMENTS (S + A series)
-- Dynamic split per tenant settings
-- ============================================
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES queue_tickets(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patient_profiles(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  series VARCHAR(1) NOT NULL CHECK (series IN ('S','A')),
  gross_amount DECIMAL(10, 2) NOT NULL,
  platform_fee DECIMAL(10, 2) NOT NULL,
  hospital_rebate DECIMAL(10, 2) NOT NULL,
  payment_method VARCHAR(20) DEFAULT 'FPX'
    CHECK (payment_method IN ('FPX','CREDIT_CARD','DEBIT_CARD','SIMULATED')),
  fpx_reference VARCHAR(100),
  status VARCHAR(10) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','SUCCESS','FAILED','REFUNDED')),
  paid_at TIMESTAMP,
  refunded_at TIMESTAMP,
  refund_reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_payments_ticket ON payments(ticket_id);
CREATE INDEX idx_payments_patient ON payments(patient_id);
CREATE INDEX idx_payments_tenant ON payments(tenant_id);
CREATE INDEX idx_payments_status ON payments(status);

-- ============================================
-- 11. GEOFENCE EVENTS
-- ============================================
CREATE TABLE geofence_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES queue_tickets(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patient_profiles(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  triggered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lat DECIMAL(10, 7) NOT NULL,
  lng DECIMAL(10, 7) NOT NULL,
  distance_meters INTEGER NOT NULL
);
CREATE INDEX idx_geofence_ticket ON geofence_events(ticket_id);
CREATE INDEX idx_geofence_triggered ON geofence_events(triggered_at);

-- ============================================
-- 12. JUDGE LOG (Every forfeit The Judge executes)
-- ============================================
CREATE TABLE judge_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES queue_sessions(id) ON DELETE CASCADE,
  ticket_id UUID NOT NULL REFERENCES queue_tickets(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  action VARCHAR(10) NOT NULL CHECK (action IN ('FORFEITED','CHECKED')),
  reason TEXT,
  eta_deadline TIMESTAMP,
  executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_judge_session ON judge_log(session_id);
CREATE INDEX idx_judge_ticket ON judge_log(ticket_id);
CREATE INDEX idx_judge_executed ON judge_log(executed_at);

-- ============================================
-- 13. AUTO SKIP LOG
-- Every time system promotes ARRIVED over PENDING
-- THIS IS THE PATENT TRAIL
-- ============================================
CREATE TABLE auto_skip_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES queue_sessions(id) ON DELETE CASCADE,
  skipped_ticket_id UUID NOT NULL REFERENCES queue_tickets(id) ON DELETE CASCADE,
  promoted_ticket_id UUID NOT NULL REFERENCES queue_tickets(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  skip_reason VARCHAR(30) DEFAULT 'CLINIC_VACANT_PATIENT_PRESENT',
  executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_autoskip_session ON auto_skip_log(session_id);
CREATE INDEX idx_autoskip_executed ON auto_skip_log(executed_at);

-- ============================================
-- 14. NOTIFICATIONS
-- Push to patients (SMS/PWA) and staff dashboards
-- ============================================
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Target: either patient or staff
  patient_id UUID REFERENCES patient_profiles(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  ticket_id UUID REFERENCES queue_tickets(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  type VARCHAR(30) NOT NULL CHECK (type IN (
    -- Patient notifications
    'BOOKING_CONFIRMED',
    'APPOINTMENT_CONFIRMED',
    'ETA_REMINDER',
    'GEOFENCE_ACKNOWLEDGED',
    'PLEASE_GO_TO_COUNTER',
    'YOU_ARE_NEXT',
    'CALLED_NOW',
    'FORFEITED',
    'SESSION_CLOSED',
    -- Staff notifications
    'NEW_PATIENT_INCOMING',
    'NEW_PATIENT_ARRIVED',
    'EXISTING_PATIENT_ARRIVED',
    'PATIENT_VERIFIED',
    'EMR_READY',
    'APPOINTMENT_KEYED'
  )),
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_notif_patient ON notifications(patient_id);
CREATE INDEX idx_notif_user ON notifications(user_id);
CREATE INDEX idx_notif_ticket ON notifications(ticket_id);
CREATE INDEX idx_notif_type ON notifications(type);
CREATE INDEX idx_notif_read ON notifications(is_read);

-- ============================================
-- TRIGGERS — updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_departments_updated_at BEFORE UPDATE ON departments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_patient_profiles_updated_at BEFORE UPDATE ON patient_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_sessions_updated_at BEFORE UPDATE ON queue_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_tickets_updated_at BEFORE UPDATE ON queue_tickets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_bookings_updated_at BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_payments_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- SCHEMA COMPLETE v2.0
-- ============================================
-- 14 Tables:
-- tenants, departments, operation_hours,
-- users, staff_assignments,
-- patient_profiles,
-- queue_sessions, queue_tickets,
-- bookings, payments,
-- geofence_events, judge_log,
-- auto_skip_log, notifications
-- ============================================