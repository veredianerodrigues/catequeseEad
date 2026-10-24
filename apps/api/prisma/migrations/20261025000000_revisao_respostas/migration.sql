-- AlterTable
ALTER TABLE `Answer` ADD COLUMN `gradedAt` DATETIME(3) NULL,
    ADD COLUMN `gradedById` VARCHAR(191) NULL,
    ADD COLUMN `isCorrect` BOOLEAN NULL;

-- AlterTable
ALTER TABLE `Questionnaire` ADD COLUMN `createdById` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `Questionnaire_createdById_idx` ON `Questionnaire`(`createdById`);

-- AddForeignKey
ALTER TABLE `Questionnaire` ADD CONSTRAINT `Questionnaire_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Answer` ADD CONSTRAINT `Answer_gradedById_fkey` FOREIGN KEY (`gradedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

