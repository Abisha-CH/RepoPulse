-- AlterTable
ALTER TABLE "pull_requests" ADD COLUMN     "additions" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ci_status" TEXT,
ADD COLUMN     "deletions" INTEGER NOT NULL DEFAULT 0;
