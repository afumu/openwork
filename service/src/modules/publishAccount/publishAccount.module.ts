import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PublishAccountController } from './publishAccount.controller';
import { PublishAccountEntity } from './publishAccount.entity';
import { PublishAccountService } from './publishAccount.service';
import { PublishExecutionService } from './publishExecution.service';
import { WechatCoverService } from './wechatCover.service';
import { WechatPublisher } from './wechatPublisher';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([PublishAccountEntity])],
  controllers: [PublishAccountController],
  providers: [PublishAccountService, PublishExecutionService, WechatCoverService, WechatPublisher],
  exports: [PublishAccountService, PublishExecutionService],
})
export class PublishAccountModule {}
