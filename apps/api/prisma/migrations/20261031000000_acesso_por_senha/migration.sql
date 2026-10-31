-- Acesso por e-mail e senha: googleSub passa a ser opcional (contas por senha não têm).
-- Os usuários existentes são todos do Google, portanto ficam com e-mail confirmado. Nenhum dado é removido.
ALTER TABLE `User`
    MODIFY `googleSub` VARCHAR(191) NULL,
    ADD COLUMN `passwordHash` VARCHAR(255) NULL,
    ADD COLUMN `emailVerified` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `mustChangePassword` BOOLEAN NOT NULL DEFAULT false;

UPDATE `User` SET `emailVerified` = true WHERE `googleSub` IS NOT NULL;
