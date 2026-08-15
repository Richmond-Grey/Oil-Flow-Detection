-- AlterTable
ALTER TABLE "AlertLog" ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "retryCount" INTEGER NOT NULL DEFAULT 0;
