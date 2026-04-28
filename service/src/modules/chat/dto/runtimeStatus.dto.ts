import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';

export class RuntimeStatusDto {
  @ApiProperty({ example: 128, description: '对话组 ID' })
  @IsNotEmpty({ message: '对话组ID不能为空！' })
  groupId: number;
}
