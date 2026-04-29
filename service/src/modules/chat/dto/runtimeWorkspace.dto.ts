import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional } from 'class-validator';

export class RuntimeWorkspaceListDto {
  @ApiProperty({ example: 128, description: '对话组 ID' })
  @IsNotEmpty({ message: '对话组ID不能为空！' })
  groupId: number;
}

export class RuntimeWorkspaceReadDto {
  @ApiProperty({ example: 128, description: '对话组 ID' })
  @IsNotEmpty({ message: '对话组ID不能为空！' })
  groupId: number;

  @ApiProperty({ example: 'README.md', description: '工作区内的相对文件路径' })
  @IsNotEmpty({ message: '文件路径不能为空！' })
  path: string;

  @IsOptional()
  runId?: string;
}
