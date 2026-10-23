-- Categoria vira Assunto (preserva dados), questões passam a ter assunto obrigatório e novos tipos.

-- 1) Category -> Subject
ALTER TABLE `Question` DROP FOREIGN KEY `Question_categoryId_fkey`;
DROP INDEX `Question_categoryId_idx` ON `Question`;
RENAME TABLE `Category` TO `Subject`;
ALTER TABLE `Subject`
    ADD COLUMN `description` TEXT NULL,
    ADD COLUMN `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);
ALTER TABLE `Subject` RENAME INDEX `Category_name_key` TO `Subject_name_key`;

-- 2) Question: novos campos e tipos
ALTER TABLE `Question`
    ADD COLUMN `contentHash` VARCHAR(64) NOT NULL DEFAULT '',
    ADD COLUMN `expectedAnswer` TEXT NULL,
    ADD COLUMN `explanation` TEXT NULL,
    ADD COLUMN `subjectId` VARCHAR(191) NULL,
    MODIFY `type` ENUM('OPEN', 'SINGLE', 'MULTIPLE', 'ASSERTIONS', 'TRUE_FALSE') NOT NULL;

-- Questões com exatamente uma alternativa correta passam a ser múltipla escolha (SINGLE).
UPDATE `Question` q
SET q.`type` = 'SINGLE'
WHERE q.`type` = 'MULTIPLE'
  AND (SELECT COUNT(*) FROM `Alternative` a WHERE a.`questionId` = q.`id` AND a.`isCorrect` = 1) = 1;

-- 3) Assunto obrigatório: questões sem categoria vão para "Sem assunto".
UPDATE `Question` SET `subjectId` = `categoryId` WHERE `categoryId` IS NOT NULL;
INSERT INTO `Subject` (`id`, `name`, `status`)
SELECT 'subject_sem_assunto', 'Sem assunto', 'ACTIVE'
WHERE EXISTS (SELECT 1 FROM `Question` WHERE `subjectId` IS NULL);
UPDATE `Question` SET `subjectId` = 'subject_sem_assunto' WHERE `subjectId` IS NULL;
ALTER TABLE `Question` DROP COLUMN `categoryId`, MODIFY `subjectId` VARCHAR(191) NOT NULL;

CREATE INDEX `Question_subjectId_contentHash_idx` ON `Question`(`subjectId`, `contentHash`);
ALTER TABLE `Question` ADD CONSTRAINT `Question_subjectId_fkey` FOREIGN KEY (`subjectId`) REFERENCES `Subject`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4) Itens (assertivas / verdadeiro ou falso) e respostas por item
CREATE TABLE `QuestionItem` (
    `id` VARCHAR(191) NOT NULL,
    `questionId` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL,
    `text` TEXT NOT NULL,
    `isTrue` BOOLEAN NULL,

    INDEX `QuestionItem_questionId_position_idx`(`questionId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AnswerItem` (
    `answerId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `value` BOOLEAN NOT NULL,

    PRIMARY KEY (`answerId`, `itemId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `QuestionItem` ADD CONSTRAINT `QuestionItem_questionId_fkey` FOREIGN KEY (`questionId`) REFERENCES `Question`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AnswerItem` ADD CONSTRAINT `AnswerItem_answerId_fkey` FOREIGN KEY (`answerId`) REFERENCES `Answer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AnswerItem` ADD CONSTRAINT `AnswerItem_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `QuestionItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
