import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional } from 'class-validator';

export class StopChatDto {
  @ApiPropertyOptional({ example: 123, description: '当前会话 groupId' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  groupId?: number;

  @ApiPropertyOptional({ example: 456, description: '当前回答 chatId，groupId 不存在时回退使用' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  chatId?: number;
}
