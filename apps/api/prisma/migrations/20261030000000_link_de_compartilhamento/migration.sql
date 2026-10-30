-- Link de compartilhamento por questionário; os já existentes continuam listados na página inicial.
ALTER TABLE `Questionnaire`
    ADD COLUMN `shareCode` VARCHAR(32) NULL,
    ADD COLUMN `listed` BOOLEAN NOT NULL DEFAULT false;

UPDATE `Questionnaire` SET `listed` = true;
UPDATE `Questionnaire` SET `shareCode` = SUBSTRING(MD5(CONCAT(`id`, RAND(), UUID())), 1, 10);

ALTER TABLE `Questionnaire` MODIFY `shareCode` VARCHAR(32) NOT NULL;
CREATE UNIQUE INDEX `Questionnaire_shareCode_key` ON `Questionnaire`(`shareCode`);
