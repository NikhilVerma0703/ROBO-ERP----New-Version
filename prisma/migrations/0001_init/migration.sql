-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "RoboMachine" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoboMachine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoboDesign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "seriesName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoboDesign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoboProgram" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "designId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoboProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoboTool" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoboTool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoboLiquid" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoboLiquid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoboPowder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoboPowder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoboOperator" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoboOperator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoboDelayCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "isRobotSpecific" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoboDelayCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoboShift" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "shiftNumber" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "operatorName" TEXT NOT NULL DEFAULT '',
    "notes" TEXT,
    "roycut1CycleTime" INTEGER,
    "roycut2CycleTime" INTEGER,
    "roycut3CycleTime" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoboShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoboBatchRecipe" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "productionDate" TEXT,
    "batchNo" TEXT,
    "designId" TEXT,
    "programId" TEXT,
    "designName" TEXT NOT NULL DEFAULT '',
    "programName" TEXT NOT NULL DEFAULT '',
    "targetSlabs" INTEGER,
    "thickness" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoboBatchRecipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoboBatchRecipeEntry" (
    "id" TEXT NOT NULL,
    "batchRecipeId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "programName" TEXT,
    "toolName" TEXT,
    "liquidName" TEXT,
    "powderName" TEXT,
    "rollerHeight" TEXT,
    "targetCycleTime" INTEGER,
    "notes" TEXT,

    CONSTRAINT "RoboBatchRecipeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoboProductionRecord" (
    "id" TEXT NOT NULL,
    "serialNumber" INTEGER,
    "slabNumber" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "batchRecipeId" TEXT,
    "productionDate" TEXT,
    "productionShift" TEXT,
    "inTime" TEXT,
    "outTime" TEXT,
    "roymixCycleTime" INTEGER,
    "roymixBodyWeight" DOUBLE PRECISION,
    "thickness" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoboProductionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoboDelayLog" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "productionRecordId" TEXT,
    "machineId" TEXT,
    "machineName" TEXT,
    "delayCodeId" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoboDelayLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoboImportLog" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "period" TEXT,
    "status" TEXT NOT NULL DEFAULT 'failed',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "imported" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "user" TEXT NOT NULL DEFAULT 'System Administrator',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoboImportLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_operator" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "attendance_operator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_day" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "lines" TEXT NOT NULL DEFAULT '',
    "inTime" TEXT,
    "outTime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "shiftNo" INTEGER NOT NULL DEFAULT 1,
    "outDate" TEXT,

    CONSTRAINT "attendance_day_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_leave" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "fromTime" TEXT,
    "toTime" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "leaveType" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "attendance_leave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_log" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT,
    "batch_key" TEXT,
    "kind" TEXT NOT NULL,
    "model" TEXT,
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "undone" BOOLEAN NOT NULL DEFAULT false,
    "undone_at" TIMESTAMP(3),

    CONSTRAINT "action_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mis" (
    "id" TEXT NOT NULL,
    "airtableId" TEXT NOT NULL,
    "shift" JSONB,
    "hour" TEXT,
    "submitted_by" TEXT,
    "created_time" TIMESTAMP(3),
    "date_and_time" TIMESTAMP(3),
    "date" TIMESTAMP(3),
    "batch" TEXT,
    "design" TEXT,
    "production_type" TEXT,
    "target_production" JSONB,
    "starting_slab_number" DOUBLE PRECISION,
    "ending_slab_number" DOUBLE PRECISION,
    "number_of_jumped_slabs" DOUBLE PRECISION,
    "number_of_slabs_produced" JSONB,
    "achievable_slab_output" JSONB,
    "total_deviation" JSONB,
    "a_category" DOUBLE PRECISION,
    "a_category2" DOUBLE PRECISION,
    "b_category" DOUBLE PRECISION,
    "c_category" DOUBLE PRECISION,
    "reason_for_deviation" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "any_breakdown_yes_no" TEXT,
    "details" TEXT,
    "process_delay_duration_minutes" DOUBLE PRECISION,
    "cleaning_delay_duration_minutes" DOUBLE PRECISION,
    "breakdown_delay_duration_mechanical_or_electrical_minutes" DOUBLE PRECISION,
    "powerout_delay_duration_minutes" DOUBLE PRECISION,
    "rca_no" TEXT,
    "action_taken" TEXT,
    "spares_used" TEXT,
    "additional_remarks" TEXT,
    "plant_availability" JSONB,
    "efficiency" JSONB,
    "overall_equipment_effectiveness" JSONB,
    "achievable_overall_efficiency" JSONB,
    "slab_summary" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "slabs_per_hour_std" DOUBLE PRECISION,
    "slabs_per_hour_actual" DOUBLE PRECISION,
    "cycles_unloaded" DOUBLE PRECISION,
    "cycles_mixed" DOUBLE PRECISION,
    "thk_at_mixer_mm" DOUBLE PRECISION,
    "thk_at_press_mm" TEXT,
    "area_of_problem" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "production_incharge_name" TEXT,
    "maintenance_incharge_name" TEXT,
    "electrical_incharge_name" TEXT,
    "mechanical_incharge_name" TEXT,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synced_at" TIMESTAMP(3) NOT NULL,
    "batch_key" TEXT,
    "entered_by_user_id" TEXT,

    CONSTRAINT "mis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "polish_qc" (
    "id" TEXT NOT NULL,
    "airtableId" TEXT NOT NULL,
    "slab_number" DOUBLE PRECISION,
    "batch_number" TEXT,
    "design" TEXT,
    "created_time" TIMESTAMP(3),
    "last_modified_by" JSONB,
    "rw_status" TEXT,
    "repolish_status" TEXT,
    "inspector" TEXT,
    "going_to_dispatch" TEXT,
    "rw_done_by" TEXT,
    "slab_thickness" TEXT,
    "quality_issue" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "quality_grade" TEXT,
    "quality_grade_before_cts" TEXT,
    "slab_mark" TEXT NOT NULL DEFAULT 'FULL_SLAB',
    "top_polish" BOOLEAN NOT NULL DEFAULT false,
    "bottom_polish" BOOLEAN NOT NULL DEFAULT false,
    "lamination" BOOLEAN NOT NULL DEFAULT false,
    "sku" TEXT,
    "bay" TEXT,
    "polish_type" TEXT DEFAULT 'Polish',
    "dispatch_status" TEXT,
    "barcode" JSONB,
    "barcode_api_link" JSONB,
    "link" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "barcode_from_link" JSONB,
    "batch_number_from_link" JSONB,
    "main_body_l" DOUBLE PRECISION,
    "main_body_a" DOUBLE PRECISION,
    "main_body_b" DOUBLE PRECISION,
    "b_body_l" DOUBLE PRECISION,
    "b_body_a" DOUBLE PRECISION,
    "b_body_b" DOUBLE PRECISION,
    "f_3rd_body_l" DOUBLE PRECISION,
    "f_3rd_body_a" DOUBLE PRECISION,
    "f_3rd_body_b" DOUBLE PRECISION,
    "image" JSONB,
    "shed_4_to_5" BOOLEAN NOT NULL DEFAULT false,
    "sent_to_chromia" BOOLEAN NOT NULL DEFAULT false,
    "remarks" TEXT,
    "formula" JSONB,
    "printed" BOOLEAN NOT NULL DEFAULT false,
    "chromia_1" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "slab_summary" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "slab_segregation" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "chromia_1_copy" TEXT,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synced_at" TIMESTAMP(3) NOT NULL,
    "batch_key" TEXT,
    "entered_by_user_id" TEXT,

    CONSTRAINT "polish_qc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_line_order_batch" (
    "line_order" INTEGER NOT NULL,
    "batch" TEXT,
    "batch_key" TEXT,
    "design" TEXT,
    "source" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "evidence" JSONB,
    "set_by_user_id" TEXT,
    "set_by_name" TEXT,
    "set_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_line_order_batch_pkey" PRIMARY KEY ("line_order")
);

-- CreateTable
CREATE TABLE "plant_slab" (
    "plant_key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "read_at" TIMESTAMP(3),
    "row_hash" TEXT NOT NULL,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "change_count" INTEGER NOT NULL DEFAULT 0,
    "post_id" TEXT,
    "f_id" INTEGER NOT NULL,
    "article" TEXT,
    "slab_no" INTEGER,
    "line_order" INTEGER,
    "sts_begin" TIMESTAMP(3),
    "krs_begin" TIMESTAMP(3),
    "pre_begin" TIMESTAMP(3),
    "ove_end" TIMESTAMP(3),

    CONSTRAINT "plant_slab_pkey" PRIMARY KEY ("plant_key")
);

-- CreateTable
CREATE TABLE "plant_mix_line" (
    "plant_key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "read_at" TIMESTAMP(3),
    "row_hash" TEXT NOT NULL,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "change_count" INTEGER NOT NULL DEFAULT 0,
    "post_id" TEXT,
    "f_id" INTEGER NOT NULL,
    "f_code" TEXT,
    "f_date" TIMESTAMP(3),
    "product_order" TEXT,

    CONSTRAINT "plant_mix_line_pkey" PRIMARY KEY ("plant_key")
);

-- CreateTable
CREATE TABLE "plant_channel_order" (
    "plant_key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "read_at" TIMESTAMP(3),
    "row_hash" TEXT NOT NULL,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "change_count" INTEGER NOT NULL DEFAULT 0,
    "post_id" TEXT,
    "f_id" INTEGER NOT NULL,
    "work_order_id" INTEGER,
    "channel" INTEGER,
    "state" INTEGER,
    "lud" TIMESTAMP(3),
    "line_order" INTEGER,
    "wo_index" INTEGER,

    CONSTRAINT "plant_channel_order_pkey" PRIMARY KEY ("plant_key")
);

-- CreateTable
CREATE TABLE "plant_press_slab" (
    "plant_key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "read_at" TIMESTAMP(3),
    "row_hash" TEXT NOT NULL,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "change_count" INTEGER NOT NULL DEFAULT 0,
    "post_id" TEXT,
    "slab_code" TEXT NOT NULL,
    "slab_no" INTEGER,
    "first_id" BIGINT,
    "last_id" BIGINT,
    "last_at" TIMESTAMP(3),

    CONSTRAINT "plant_press_slab_pkey" PRIMARY KEY ("plant_key")
);

-- CreateTable
CREATE TABLE "plant_press_hourly" (
    "plant_key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "read_at" TIMESTAMP(3),
    "row_hash" TEXT NOT NULL,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "change_count" INTEGER NOT NULL DEFAULT 0,
    "post_id" TEXT,
    "id" BIGINT NOT NULL,
    "tag_name" TEXT,
    "stamp" TIMESTAMP(3),

    CONSTRAINT "plant_press_hourly_pkey" PRIMARY KEY ("plant_key")
);

-- CreateTable
CREATE TABLE "plant_line_order" (
    "plant_key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "read_at" TIMESTAMP(3),
    "row_hash" TEXT NOT NULL,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "change_count" INTEGER NOT NULL DEFAULT 0,
    "post_id" TEXT,
    "f_id" INTEGER NOT NULL,
    "lud" TIMESTAMP(3),
    "qty" INTEGER,
    "description" TEXT,

    CONSTRAINT "plant_line_order_pkey" PRIMARY KEY ("plant_key")
);

-- CreateTable
CREATE TABLE "plant_setting_change" (
    "plant_key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "read_at" TIMESTAMP(3),
    "row_hash" TEXT NOT NULL,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "change_count" INTEGER NOT NULL DEFAULT 0,
    "post_id" TEXT,
    "f_id" INTEGER NOT NULL,
    "lud" TIMESTAMP(3) NOT NULL,
    "obj_name" TEXT,
    "value_num" DOUBLE PRECISION,
    "value_word" BIGINT,
    "value_text" TEXT,
    "observed_at" TIMESTAMP(3),

    CONSTRAINT "plant_setting_change_pkey" PRIMARY KEY ("plant_key")
);

-- CreateTable
CREATE TABLE "plant_gev_deploy" (
    "plant_key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "read_at" TIMESTAMP(3),
    "row_hash" TEXT NOT NULL,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "change_count" INTEGER NOT NULL DEFAULT 0,
    "post_id" TEXT,
    "audit_id" TEXT NOT NULL,
    "deployment_id" TEXT,
    "instance_id" TEXT,
    "created_on_utc" TIMESTAMP(3),
    "title" TEXT,

    CONSTRAINT "plant_gev_deploy_pkey" PRIMARY KEY ("plant_key")
);

-- CreateTable
CREATE TABLE "plant_sync_post" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ok" BOOLEAN NOT NULL,
    "kind" TEXT,
    "test" BOOLEAN NOT NULL DEFAULT false,
    "pc_host" TEXT,
    "pc_script" TEXT,
    "pc_made_at" TEXT,
    "rows_in" INTEGER NOT NULL DEFAULT 0,
    "stored" JSONB,
    "rejected" JSONB,
    "cursors" JSONB,
    "pc_errors" JSONB,
    "latch" JSONB,
    "outbox" INTEGER,
    "refusal" TEXT,
    "bytes" INTEGER,
    "ms" INTEGER,

    CONSTRAINT "plant_sync_post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plant_sync_state" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plant_sync_state_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoboMachine_name_key" ON "RoboMachine"("name");

-- CreateIndex
CREATE UNIQUE INDEX "RoboDesign_name_key" ON "RoboDesign"("name");

-- CreateIndex
CREATE UNIQUE INDEX "RoboProgram_name_key" ON "RoboProgram"("name");

-- CreateIndex
CREATE UNIQUE INDEX "RoboTool_name_key" ON "RoboTool"("name");

-- CreateIndex
CREATE UNIQUE INDEX "RoboLiquid_name_key" ON "RoboLiquid"("name");

-- CreateIndex
CREATE UNIQUE INDEX "RoboPowder_name_key" ON "RoboPowder"("name");

-- CreateIndex
CREATE UNIQUE INDEX "RoboOperator_name_key" ON "RoboOperator"("name");

-- CreateIndex
CREATE UNIQUE INDEX "RoboDelayCode_code_key" ON "RoboDelayCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "RoboShift_date_shiftNumber_key" ON "RoboShift"("date", "shiftNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RoboBatchRecipeEntry_batchRecipeId_machineId_key" ON "RoboBatchRecipeEntry"("batchRecipeId", "machineId");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_operator_name_key" ON "attendance_operator"("name");

-- CreateIndex
CREATE INDEX "attendance_day_date_idx" ON "attendance_day"("date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_day_date_operatorId_shiftNo_key" ON "attendance_day"("date", "operatorId", "shiftNo");

-- CreateIndex
CREATE INDEX "attendance_leave_date_idx" ON "attendance_leave"("date");

-- CreateIndex
CREATE INDEX "action_log_batch_key_undone_created_at_idx" ON "action_log"("batch_key", "undone", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "mis_airtableId_key" ON "mis"("airtableId");

-- CreateIndex
CREATE INDEX "mis_batch_key_idx" ON "mis"("batch_key");

-- CreateIndex
CREATE INDEX "mis_date_and_time_idx" ON "mis"("date_and_time");

-- CreateIndex
CREATE INDEX "mis_date_idx" ON "mis"("date");

-- CreateIndex
CREATE INDEX "mis_imported_at_idx" ON "mis"("imported_at");

-- CreateIndex
CREATE UNIQUE INDEX "polish_qc_airtableId_key" ON "polish_qc"("airtableId");

-- CreateIndex
CREATE INDEX "polish_qc_batch_key_idx" ON "polish_qc"("batch_key");

-- CreateIndex
CREATE INDEX "polish_qc_slab_number_idx" ON "polish_qc"("slab_number");

-- CreateIndex
CREATE INDEX "polish_qc_imported_at_idx" ON "polish_qc"("imported_at");

-- CreateIndex
CREATE INDEX "polish_qc_created_time_idx" ON "polish_qc"("created_time");

-- CreateIndex
CREATE INDEX "plant_slab_slab_no_idx" ON "plant_slab"("slab_no");

-- CreateIndex
CREATE INDEX "plant_slab_line_order_idx" ON "plant_slab"("line_order");

-- CreateIndex
CREATE INDEX "plant_slab_pre_begin_idx" ON "plant_slab"("pre_begin");

-- CreateIndex
CREATE INDEX "plant_slab_sts_begin_idx" ON "plant_slab"("sts_begin");

-- CreateIndex
CREATE INDEX "plant_slab_krs_begin_idx" ON "plant_slab"("krs_begin");

-- CreateIndex
CREATE INDEX "plant_slab_ove_end_idx" ON "plant_slab"("ove_end");

-- CreateIndex
CREATE INDEX "plant_mix_line_f_code_idx" ON "plant_mix_line"("f_code");

-- CreateIndex
CREATE INDEX "plant_mix_line_f_date_idx" ON "plant_mix_line"("f_date");

-- CreateIndex
CREATE INDEX "plant_channel_order_work_order_id_idx" ON "plant_channel_order"("work_order_id");

-- CreateIndex
CREATE INDEX "plant_channel_order_line_order_idx" ON "plant_channel_order"("line_order");

-- CreateIndex
CREATE INDEX "plant_channel_order_lud_idx" ON "plant_channel_order"("lud");

-- CreateIndex
CREATE INDEX "plant_press_slab_slab_no_idx" ON "plant_press_slab"("slab_no");

-- CreateIndex
CREATE INDEX "plant_press_slab_last_at_idx" ON "plant_press_slab"("last_at");

-- CreateIndex
CREATE INDEX "plant_press_hourly_stamp_idx" ON "plant_press_hourly"("stamp");

-- CreateIndex
CREATE INDEX "plant_line_order_lud_idx" ON "plant_line_order"("lud");

-- CreateIndex
CREATE INDEX "plant_setting_change_f_id_lud_idx" ON "plant_setting_change"("f_id", "lud");

-- CreateIndex
CREATE INDEX "plant_gev_deploy_created_on_utc_idx" ON "plant_gev_deploy"("created_on_utc");

-- CreateIndex
CREATE INDEX "plant_sync_post_received_at_idx" ON "plant_sync_post"("received_at");

-- AddForeignKey
ALTER TABLE "RoboProgram" ADD CONSTRAINT "RoboProgram_designId_fkey" FOREIGN KEY ("designId") REFERENCES "RoboDesign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoboBatchRecipe" ADD CONSTRAINT "RoboBatchRecipe_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "RoboShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoboBatchRecipe" ADD CONSTRAINT "RoboBatchRecipe_designId_fkey" FOREIGN KEY ("designId") REFERENCES "RoboDesign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoboBatchRecipe" ADD CONSTRAINT "RoboBatchRecipe_programId_fkey" FOREIGN KEY ("programId") REFERENCES "RoboProgram"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoboBatchRecipeEntry" ADD CONSTRAINT "RoboBatchRecipeEntry_batchRecipeId_fkey" FOREIGN KEY ("batchRecipeId") REFERENCES "RoboBatchRecipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoboBatchRecipeEntry" ADD CONSTRAINT "RoboBatchRecipeEntry_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "RoboMachine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoboProductionRecord" ADD CONSTRAINT "RoboProductionRecord_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "RoboShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoboProductionRecord" ADD CONSTRAINT "RoboProductionRecord_batchRecipeId_fkey" FOREIGN KEY ("batchRecipeId") REFERENCES "RoboBatchRecipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoboDelayLog" ADD CONSTRAINT "RoboDelayLog_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "RoboShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoboDelayLog" ADD CONSTRAINT "RoboDelayLog_productionRecordId_fkey" FOREIGN KEY ("productionRecordId") REFERENCES "RoboProductionRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoboDelayLog" ADD CONSTRAINT "RoboDelayLog_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "RoboMachine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoboDelayLog" ADD CONSTRAINT "RoboDelayLog_delayCodeId_fkey" FOREIGN KEY ("delayCodeId") REFERENCES "RoboDelayCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_day" ADD CONSTRAINT "attendance_day_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "attendance_operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_leave" ADD CONSTRAINT "attendance_leave_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "attendance_operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

