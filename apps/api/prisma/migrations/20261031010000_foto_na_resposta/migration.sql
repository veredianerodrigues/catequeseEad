-- Foto anexada à resposta aberta. Somente novas colunas opcionais: nenhum dado existente é alterado.
ALTER TABLE `Answer`
    ADD COLUMN `photoKey` VARCHAR(191) NULL,
    ADD COLUMN `photoMime` VARCHAR(191) NULL,
    ADD COLUMN `photoSize` INTEGER NULL;

CREATE UNIQUE INDEX `Answer_photoKey_key` ON `Answer`(`photoKey`);
