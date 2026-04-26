import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class RuntimeExecDto {
  @ApiProperty({ example: 128, description: '当前对话 groupId' })
  @IsInt()
  @Min(1)
  groupId: number;

  @ApiProperty({ example: 'ls -la', description: '要在当前对话运行时工作区执行的命令' })
  @IsString()
  @MaxLength(4000)
  command: string;

  @ApiProperty({
    example: '/workspace/conversations/128/src',
    description: '终端当前工作目录；为空时使用当前对话工作区根目录',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  cwd?: string;
}
