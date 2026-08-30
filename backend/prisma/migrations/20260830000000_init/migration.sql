-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "github_id" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "access_token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repos" (
    "id" TEXT NOT NULL,
    "github_repo_id" INTEGER NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "connected_by_user_id" TEXT NOT NULL,

    CONSTRAINT "repos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pull_requests" (
    "id" TEXT NOT NULL,
    "repo_id" TEXT NOT NULL,
    "github_pr_id" INTEGER NOT NULL,
    "author" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL,
    "first_review_at" TIMESTAMP(3),
    "merged_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "pull_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviewers" (
    "id" TEXT NOT NULL,
    "pull_request_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "reviewed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reviewers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_github_id_key" ON "users"("github_id");

-- CreateIndex
CREATE UNIQUE INDEX "repos_github_repo_id_key" ON "repos"("github_repo_id");

-- CreateIndex
CREATE INDEX "repos_connected_by_user_id_idx" ON "repos"("connected_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "repos_owner_name_key" ON "repos"("owner", "name");

-- CreateIndex
CREATE INDEX "pull_requests_repo_id_opened_at_idx" ON "pull_requests"("repo_id", "opened_at");

-- CreateIndex
CREATE INDEX "pull_requests_repo_id_first_review_at_idx" ON "pull_requests"("repo_id", "first_review_at");

-- CreateIndex
CREATE INDEX "pull_requests_repo_id_merged_at_idx" ON "pull_requests"("repo_id", "merged_at");

-- CreateIndex
CREATE INDEX "pull_requests_repo_id_closed_at_idx" ON "pull_requests"("repo_id", "closed_at");

-- CreateIndex
CREATE INDEX "pull_requests_merged_at_idx" ON "pull_requests"("merged_at");

-- CreateIndex
CREATE UNIQUE INDEX "pull_requests_repo_id_github_pr_id_key" ON "pull_requests"("repo_id", "github_pr_id");

-- CreateIndex
CREATE INDEX "reviewers_pull_request_id_idx" ON "reviewers"("pull_request_id");

-- CreateIndex
CREATE INDEX "reviewers_username_reviewed_at_idx" ON "reviewers"("username", "reviewed_at");

-- AddForeignKey
ALTER TABLE "repos" ADD CONSTRAINT "repos_connected_by_user_id_fkey" FOREIGN KEY ("connected_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviewers" ADD CONSTRAINT "reviewers_pull_request_id_fkey" FOREIGN KEY ("pull_request_id") REFERENCES "pull_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

