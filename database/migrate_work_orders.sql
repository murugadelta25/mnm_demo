-- Work order master + plan linkage
USE eap_pms;

CREATE TABLE IF NOT EXISTS work_orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    work_order_no VARCHAR(100) NOT NULL UNIQUE,
    part_id INT,
    model_variant VARCHAR(100),
    description VARCHAR(255),
    target_qty INT NOT NULL,
    start_date DATE,
    end_date DATE,
    status ENUM('draft','in_progress','completed','cancelled','closed') DEFAULT 'draft',
    spares_tools_json TEXT,
    outstanding_qty INT DEFAULT 0,
    outstanding_status VARCHAR(20) DEFAULT 'none',
    consumed_by_wo_id INT NULL,
    created_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (part_id) REFERENCES parts(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Existing installs: expand status + outstanding columns
ALTER TABLE work_orders MODIFY COLUMN status
  ENUM('draft','in_progress','completed','cancelled','closed') DEFAULT 'draft';

SET @db = DATABASE();
SET @c = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=@db AND table_name='work_orders' AND column_name='outstanding_qty');
SET @sql = IF(@c=0, 'ALTER TABLE work_orders ADD COLUMN outstanding_qty INT DEFAULT 0', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=@db AND table_name='work_orders' AND column_name='outstanding_status');
SET @sql = IF(@c=0, 'ALTER TABLE work_orders ADD COLUMN outstanding_status VARCHAR(20) DEFAULT ''none''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=@db AND table_name='work_orders' AND column_name='consumed_by_wo_id');
SET @sql = IF(@c=0, 'ALTER TABLE work_orders ADD COLUMN consumed_by_wo_id INT NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=@db AND table_name='production_plans' AND column_name='work_order_id');
SET @sql = IF(@c=0,
  'ALTER TABLE production_plans ADD COLUMN work_order_id INT NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
