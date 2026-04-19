import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString } from 'class-validator';

export class SyncWechatDraftDto {
  @ApiProperty({ description: '对话分组 ID' })
  @IsNumber()
  groupId: number;

  @ApiProperty({ description: '产物路径' })
  @IsString()
  path: string;

  @ApiProperty({ description: '运行目录 ID', required: false })
  @IsOptional()
  @IsString()
  runId?: string;

  @ApiProperty({ description: '当前编辑后的发布工作副本 Markdown' })
  @IsString()
  markdown: string;
}
