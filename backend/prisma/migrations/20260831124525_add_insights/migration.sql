-- CreateTable
CREATE TABLE "insights" (
    "id" TEXT NOT NULL,
    "repo_id" TEXT NOT NULL,
    "pr_snapshot" INTEGER NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" JSONB NOT NULL,

    CONSTRAINT "insights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "insights_repo_id_generated_at_idx" ON "insights"("repo_id", "generated_at");

-- AddForeignKey
ALTER TABLE "insights" ADD CONSTRAINT "insights_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
