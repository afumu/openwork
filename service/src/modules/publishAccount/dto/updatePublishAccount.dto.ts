import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdatePublishAccountDto {
  @ApiProperty({ description: '账号 ID' })
  @IsNumber()
  id: number;

  @ApiProperty({ description: '账号名称', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  accountName?: string;

  @ApiProperty({ description: '微信公众号 AppId', required: false })
  @IsOptional()
  @IsString()
  wechatAppId?: string;

  @ApiProperty({ description: '微信公众号 AppSecret', required: false })
  @IsOptional()
  @IsString()
  wechatAppSecret?: string;

  @ApiProperty({ description: '是否设为默认账号', required: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
