import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, MaxLength, Min } from 'class-validator';

export class RuntimeExecDto {
  @ApiProperty({ example: 128, description: '当前对话 groupId' })
  @IsInt()
  @Min(1)
  groupId: number;

  @ApiProperty({ example: 'ls -la', description: '要在当前对话运行时工作区执行的命令' })
  @IsString()
  @MaxLength(4000)
  command: string;
}
