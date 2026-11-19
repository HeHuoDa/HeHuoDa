-- 川农统一身份认证匿名登录事务。纯新增表，不修改 0001-0013 的任何结构或数据。
-- 事务在确认学校身份前没有平台账号，因此不能复用 campus_transactions（user_id 非空）。
CREATE TABLE school_login_transactions (
 id text PRIMARY KEY,
 holder_hash text NOT NULL,
 instance_id text NOT NULL,
 term_id text NOT NULL,
 status text NOT NULL CHECK (status IN ('waiting','processing','succeeded','failed','cancelled','expired')),
 operation text,
 challenge_version text,
 reason text,
 created_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 finished_at timestamptz
);
-- 同一持有凭证同时只有一个活动事务；持有凭证只存摘要，仅凭事务 ID 不能操作。
CREATE UNIQUE INDEX school_login_one_active_holder ON school_login_transactions(holder_hash) WHERE status IN ('waiting','processing');
CREATE INDEX school_login_retention ON school_login_transactions(finished_at);
