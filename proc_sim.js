class RamWord {
    constructor(initialValue = 0, initialText = null) {
        this.displayMode = 0;
        this.getValue = () => this.numValue & ((1 << WORD_SIZE) - 1);
        this.numValue = initialValue;
        this.textValue = initialText;
        if (this.textValue != null || this.numValue == 0) {
            this.displayMode = 3;
        }
    }
    getTextValue() {
        if (this.textValue != null) {
            return this.textValue;
        }
        if (this.numValue == 0) {
            return "NO OP";
        }
        return null;
    }
    getSignedValue() {
        let value = this.numValue & ((1 << (WORD_SIZE - 1)) - 1);
        let sign = (this.numValue & (1 << (WORD_SIZE - 1))) != 0;
        if (sign) {
            value -= 1 << (WORD_SIZE - 1);
        }
        return value.toString(10);
    }
    getHexValue() {
        let value = this.numValue & ((1 << WORD_SIZE) - 1);
        return `0x${value.toString(16).padStart(Math.ceil(WORD_SIZE / 4), '0')}`;
    }
    getBinaryValue() {
        let value = this.numValue & ((1 << WORD_SIZE) - 1);
        return `0b${value.toString(2).padStart(WORD_SIZE, '0')}`;
    }
    getDisplayValue() {
        switch (this.displayMode) {
            case 0: return this.getSignedValue();
            case 1: return this.getHexValue();
            case 2: return this.getBinaryValue();
            case 3: return this.getTextValue();
        }
    }
    cycleDisplayMode() {
        this.displayMode += 1;
        this.displayMode %= this.textValue == null && this.numValue != 0 ? 3 : 4;
    }
    setValue(numValue, textValue = null) {
        this.textValue = textValue;
        this.numValue = numValue & ((1 << WORD_SIZE) - 1);
    }
}
class ReadOnlyBus extends RamWord {
    constructor(size) {
        super();
        // protected value: number = 0
        this.dirty = false;
        if (size > 31) {
            console.warn(`W:\tMax buss size of 31 bits due to arithmetic limitations.`);
            size = 31;
        }
        this.size = size;
        this.maxValue = (1 << size) - 1;
    }
    isDirty() {
        return this.dirty;
    }
    clean() {
        this.dirty = false;
    }
    // public getValue(): number {
    //     return this.value.getValue()
    // }
    reset() {
        this.numValue = 0;
    }
    setValue(i) {
        console.warn("can't set a read only bus");
    }
}
class Bus extends ReadOnlyBus {
    setValue(value) {
        value = value & this.maxValue;
        if (this.isDirty()) {
            console.warn(`W:\tBus already modified this phase!`);
        }
        if (!Number.isInteger(value)) {
            console.warn(`W:\tInteger expected, found float (${value}) - rounding down`);
            value = Math.floor(value);
        }
        if (value > this.maxValue) {
            console.warn(`W:\tValue (${value}) larger than maximum (${this.maxValue}) - truncating.`);
            value = value & this.maxValue;
        }
        this.numValue = value;
        this.dirty = true;
    }
}
const CTRL_SET = 0b001;
const CTRL_ENB = 0b010;
const CTRL_INC = 0b100; // only used by program counter
class Register extends ReadOnlyBus {
    constructor(size, name, inputBus, controlBus) {
        super(size);
        this.displayMode = 2;
        this.name = name;
        this.dataBus = inputBus;
        this.controlBus = controlBus;
    }
    cycleDisplayMode() {
        // super.cycleDisplayMode();
        this.displayMode += 1;
        this.displayMode %= 3;
    }
    update_enable() {
        if (this.controlBus.getValue() & CTRL_ENB) {
            this.dataBus.setValue(this.numValue);
        }
    }
    update_set() {
        let ctrl = this.controlBus.getValue();
        if (ctrl & CTRL_SET) {
            this.numValue = this.dataBus.getValue();
            this.dirty = true;
        }
        else if (ctrl & CTRL_INC && !this.isDirty()) {
            this.numValue = (this.numValue + 1) & this.maxValue;
            this.dirty = true;
        }
    }
}
const ALU_ADD = 0b001;
const ALU_SUB = 0b010;
const ALU_AND = 0b011;
const ALU_OR = 0b100;
const ALU_XOR = 0b101;
const ALU_NOT = 0b110;
const ALU_INSTRUCTIONS = {
    "add": ALU_ADD,
    "sub": ALU_SUB,
    "and": ALU_AND,
    "ior": ALU_OR,
    "xor": ALU_XOR,
    "not": ALU_NOT
};
const FLGS_Z = 0b10;
const FLGS_S = 0b01;
class ArithmeticLogicUnit extends ReadOnlyBus {
    constructor(t1, t2, dataBus, controlBus) {
        super(4);
        this.inputT1 = t1;
        this.inputT2 = t2;
        this.dataBus = dataBus;
        this.controlBus = controlBus;
    }
    update() {
        let op = this.controlBus.getValue();
        if (!op) { // control not set
            return;
        }
        let a = this.inputT1.getValue() & ((1 << WORD_SIZE) - 1);
        let signA = a >> (WORD_SIZE - 1);
        let b = this.inputT2.getValue() & ((1 << WORD_SIZE) - 1);
        let signB = b >> (WORD_SIZE - 1);
        let res = 0;
        let flgs = 0b00;
        switch (op & 0b111) {
            case ALU_ADD:
                res = a + b;
                break;
            case ALU_SUB:
                res = a - b;
                break;
            case ALU_AND:
                res = a & b;
                break;
            case ALU_OR:
                res = a | b;
                break;
            case ALU_XOR:
                res = a ^ b;
                break;
            case ALU_NOT:
                res = (~a) & this.dataBus.maxValue;
                break;
        }
        res &= ((1 << WORD_SIZE) - 1);
        let signRes = res >> (WORD_SIZE - 1);
        flgs |= signRes ? FLGS_S : 0; // set sign flag
        if (res === 0) {
            flgs |= FLGS_Z; // 1 << 3 // set zero flag
        }
        this.dataBus.setValue(res);
        this.numValue = flgs;
        this.dirty = true;
    }
}
const RAM_READ = 0b001;
const RAM_WRITE = 0b010;
const RAM_INSTRUCTIONS = {
    "load": RAM_READ,
    "save": RAM_WRITE
};
class RAM {
    constructor(wordSize, controlBus, addressBus, dataBus) {
        this.controlBus = controlBus;
        this.addressBus = addressBus;
        this.dataBus = dataBus;
        this.data = Array.from({ length: (1 << wordSize) }, () => new RamWord());
    }
    update() {
        let address = this.addressBus.getValue() & ((1 << WORD_SIZE) - 1);
        let value;
        switch (this.controlBus.getValue()) {
            case CTRL_ENB:
                value = this.data[address].getValue() & ((1 << WORD_SIZE) - 1);
                this.dataBus.setValue(value);
                break;
            case CTRL_SET:
                value = this.dataBus.getValue() & ((1 << WORD_SIZE) - 1);
                this.data[address].setValue(value);
                break;
            default: // No control or invalid control state
                break;
        }
    }
}
const INS_RAM = 0b00;
const INS_B_RAM_READ = 0b001;
const INS_B_RAM_WRITE = 0b100;
const INS_ALU_R = 0b01;
const INS_ALU_I = 0b11;
const INS_JMP = 0b10;
const INS_JMP_JMP = 0b000;
const INS_JMP_JLZ = 0b001;
const INS_JMP_JGZ = 0b010;
const INS_JMP_JEZ = 0b011;
const JMP_INSTRUCTIONS = {
    "jmp": INS_JMP_JMP,
    "jlz": INS_JMP_JLZ,
    "jgz": INS_JMP_JGZ,
    "jez": INS_JMP_JEZ
};
class Decoder {
    constructor(instructionControl, instructionBus, programControl, ramControl, registerAControl, registerBControl, registerT1Control, registerT2Control, addressControl, aluControl, flags) {
        this.currentInstruction = this.fetch_step1;
        this.currentStep = () => this.currentInstruction.name;
        this.description = "";
        this.currentStepDescription = () => this.description;
        this.executeSteps = 0;
        this.ram_ins_name = "";
        this.alu_ins_name = "";
        this.jmp_ins_name = "";
        this.instructionControl = instructionControl;
        this.instructionBus = instructionBus;
        this.programControl = programControl;
        this.ramControl = ramControl;
        this.registerAControl = registerAControl;
        this.registerBControl = registerBControl;
        this.registerT1Control = registerT1Control;
        this.registerT2Control = registerT2Control;
        this.addressControl = addressControl;
        this.aluControl = aluControl;
        this.flags = flags;
    }
    reset() {
        this.currentInstruction = this.fetch_step1;
    }
    fetch_step1() {
        this.programControl.setValue(CTRL_ENB);
        this.addressControl.setValue(CTRL_SET);
        this.description = "Fetch (Step 1): Copy PC into Address Register";
        return this.fetch_step2;
    }
    fetch_step2() {
        this.programControl.setValue(CTRL_INC);
        this.addressControl.setValue(0);
        this.description = "Fetch (Step 2): Clear Control and Increment PC";
        return this.fetch_step3;
    }
    fetch_step3() {
        this.programControl.setValue(0);
        this.ramControl.setValue(CTRL_ENB);
        this.instructionControl.setValue(CTRL_SET);
        this.description = "Fetch (Step 3): Copy Ram into Instruction Register";
        return this.fetch_step4;
    }
    fetch_step4() {
        this.ramControl.setValue(0);
        this.instructionControl.setValue(0);
        this.description = "Fetch (Step 4): Clear Control";
        return this.execute;
    }
    execute() {
        // instructions built as TT III SS D (T->Type, I->Instruction, S->Source, D->Destination)
        let ins = this.instructionBus.getValue();
        this.executeSteps = 0;
        let ins_type = ins >> 6; // get only type bits from instruction
        if (ins == 0) {
            return this.fetch_step1();
        }
        switch (ins_type & 0b11) {
            case INS_RAM:
                return this.execute_ram_step1();
            case INS_ALU_I:
                return this.execute_alui_step1();
            case INS_ALU_R:
                return this.execute_alur_step1();
            case INS_JMP:
                return this.execute_jump();
        }
        return this.fetch_step1();
    }
    execute_ram_step1() {
        let ins = this.instructionBus.getValue();
        let ins_immediate = 1 & (ins >> 2); // 1 if immediate, 0 if register
        let ins_src_reg = 1 & (ins >> 1); // 0 for A, 1 for B
        let ins_body = 0b111 & (ins >> 3);
        this.executeSteps += 1;
        this.ram_ins_name = `${ins_body == RAM_READ ? 'LOAD' : 'SAVE'}`;
        if (ins_immediate)
            this.ram_ins_name += ' Immediate';
        this.description = `${this.ram_ins_name} (Step ${this.executeSteps}): Copy `;
        if (ins_immediate) {
            this.programControl.setValue(CTRL_ENB);
            this.description += 'PC';
        }
        else if (ins_src_reg === 0) {
            this.registerAControl.setValue(CTRL_ENB);
            this.description += 'Register A';
        }
        else {
            this.registerBControl.setValue(CTRL_ENB);
            this.description += 'Register B';
        }
        this.addressControl.setValue(CTRL_SET);
        this.description += ' into Address Register';
        return this.execute_ram_step2;
    }
    execute_ram_step2() {
        let ins = this.instructionBus.getValue();
        let ins_immediate = 1 & (ins >> 2); // 1 if immediate, 0 if register
        let ins_body = 0b111 & (ins >> 3);
        this.executeSteps += 1;
        this.description = `${this.ram_ins_name} (Step ${this.executeSteps}): Clear Control`;
        if (ins_immediate) {
            this.programControl.setValue(CTRL_INC);
            this.description += ' and Increment PC';
        }
        else {
            this.registerAControl.setValue(0);
            this.registerBControl.setValue(0);
        }
        this.addressControl.setValue(0);
        return this.execute_ram_step3;
    }
    execute_ram_step3() {
        let ins = this.instructionBus.getValue();
        let ins_dest_reg = 1 & (ins >> 0); // 0 for A, 1 for B
        let ins_body = 0b111 & (ins >> 3);
        this.programControl.setValue(0); // just in case
        this.executeSteps += 1;
        this.description = `${this.ram_ins_name} (Step ${this.executeSteps}): `;
        let ramRW;
        let regRW;
        switch (ins_body) {
            case INS_B_RAM_READ:
                ramRW = CTRL_ENB;
                regRW = CTRL_SET;
                this.description += 'Load Ram into REGISTER';
                break;
            case INS_B_RAM_WRITE:
            default:
                ramRW = CTRL_SET;
                regRW = CTRL_ENB;
                this.description += 'Save REGISTER into Ram';
        }
        this.ramControl.setValue(ramRW);
        if (ins_dest_reg == 0) {
            this.registerAControl.setValue(regRW);
            this.description = this.description.replace("REGISTER", 'Register A');
        }
        else {
            this.registerBControl.setValue(regRW);
            this.description = this.description.replace("REGISTER", 'Register B');
        }
        return this.execute_ram_step4;
    }
    execute_ram_step4() {
        let ins_body = 0b111 & (this.instructionBus.getValue() >> 3);
        this.executeSteps += 1;
        this.description = `${this.ram_ins_name} (Step ${this.executeSteps}): Clear Control`;
        this.ramControl.setValue(0);
        this.registerAControl.setValue(0);
        this.registerBControl.setValue(0);
        return this.fetch_step1;
    }
    execute_alui_step1() {
        let ins_body = 0b111 & (this.instructionBus.getValue() >> 3);
        this.executeSteps += 1;
        this.alu_ins_name = `${Object.keys(ALU_INSTRUCTIONS)[Object.values(ALU_INSTRUCTIONS).indexOf(ins_body)]}`;
        this.alu_ins_name = this.alu_ins_name.toUpperCase() + ' Immediate';
        this.description = `${this.alu_ins_name} (Step ${this.executeSteps}): Copy PC into Address Register`;
        this.programControl.setValue(CTRL_ENB);
        this.addressControl.setValue(CTRL_SET);
        return this.execute_alui_step2;
    }
    execute_alui_step2() {
        this.executeSteps += 1;
        this.description = `${this.alu_ins_name} (Step ${this.executeSteps}): Clear Control and Increment PC`;
        this.programControl.setValue(CTRL_INC);
        this.addressControl.setValue(0);
        return this.execute_alui_step3;
    }
    execute_alui_step3() {
        this.executeSteps += 1;
        this.description = `${this.alu_ins_name} (Step ${this.executeSteps}): Copy Ram into `;
        let ins = this.instructionBus.getValue();
        let ins_t = 1 & (ins >> 2);
        this.programControl.setValue(0);
        this.ramControl.setValue(CTRL_ENB);
        if (ins_t == 0) {
            this.description += 'Register T1';
            this.registerT1Control.setValue(CTRL_SET);
        }
        else {
            this.description += 'Register T2';
            this.registerT2Control.setValue(CTRL_SET);
        }
        return this.execute_alui_step4;
    }
    execute_alui_step4() {
        this.executeSteps += 1;
        this.description = `${this.alu_ins_name} (Step ${this.executeSteps}): Clear Control`;
        this.ramControl.setValue(0);
        this.registerT1Control.setValue(0);
        this.registerT2Control.setValue(0);
        // "not" only needs one operand
        let ins = this.instructionBus.getValue();
        let ins_body = (ins >> 3) & 0b111;
        if (ins_body == ALU_NOT) {
            return this.execute_alu_step7;
        }
        return this.execute_alui_step5;
    }
    execute_alui_step5() {
        this.executeSteps += 1;
        this.description = `${this.alu_ins_name} (Step ${this.executeSteps}): Copy Register `;
        let ins = this.instructionBus.getValue();
        let ins_t = 1 & (ins >> 2);
        let ins_r = 1 & (ins >> 1);
        if (ins_r == 0) {
            this.description += 'A';
            this.registerAControl.setValue(CTRL_ENB);
        }
        else {
            this.description += 'B';
            this.registerBControl.setValue(CTRL_ENB);
        }
        this.description += ' into Register ';
        if (ins_t == 0) {
            this.description += 'T2';
            this.registerT2Control.setValue(CTRL_SET);
        }
        else {
            this.description += 'T1';
            this.registerT1Control.setValue(CTRL_SET);
        }
        return this.execute_alui_step6;
    }
    execute_alui_step6() {
        this.executeSteps += 1;
        this.description = `${this.alu_ins_name} (Step ${this.executeSteps}): Clear Control`;
        this.registerAControl.setValue(0);
        this.registerBControl.setValue(0);
        this.registerT1Control.setValue(0);
        this.registerT2Control.setValue(0);
        return this.execute_alu_step7;
    }
    execute_alur_step1() {
        let ins = this.instructionBus.getValue();
        let ins_body = 0b111 & (this.instructionBus.getValue() >> 3);
        this.executeSteps += 1;
        this.alu_ins_name = `${Object.keys(ALU_INSTRUCTIONS)[Object.values(ALU_INSTRUCTIONS).indexOf(ins_body)]}`;
        this.alu_ins_name = this.alu_ins_name.toUpperCase();
        this.description = `${this.alu_ins_name} (Step ${this.executeSteps}): Copy Register `;
        let ins_t1 = 1 & (ins >> 2);
        if (ins_t1) {
            this.description += 'B';
            this.registerBControl.setValue(CTRL_ENB);
        }
        else {
            this.description += 'A';
            this.registerAControl.setValue(CTRL_ENB);
        }
        this.description += ' into T1';
        this.registerT1Control.setValue(CTRL_SET);
        return this.execute_alur_step2;
    }
    execute_alur_step2() {
        this.executeSteps += 1;
        this.description = `${this.alu_ins_name} (Step ${this.executeSteps}): Clear Control`;
        this.registerAControl.setValue(0);
        this.registerBControl.setValue(0);
        this.registerT1Control.setValue(0);
        // "not" only needs one operand
        let ins = this.instructionBus.getValue();
        let ins_body = (ins >> 3) & 0b111;
        if (ins_body == ALU_NOT) {
            return this.execute_alu_step7;
        }
        return this.execute_alur_step3;
    }
    execute_alur_step3() {
        this.executeSteps += 1;
        this.description = `${this.alu_ins_name} (Step ${this.executeSteps}): Copy Register `;
        let ins = this.instructionBus.getValue();
        let ins_t2 = 1 & (ins >> 1);
        if (ins_t2) {
            this.description += 'B';
            this.registerBControl.setValue(CTRL_ENB);
        }
        else {
            this.description += 'A';
            this.registerAControl.setValue(CTRL_ENB);
        }
        this.description += ' into Register T2';
        this.registerT2Control.setValue(CTRL_SET);
        return this.execute_alur_step4;
    }
    execute_alur_step4() {
        this.executeSteps += 1;
        this.description = `${this.alu_ins_name} (Step ${this.executeSteps}): Clear Control`;
        this.registerAControl.setValue(0);
        this.registerBControl.setValue(0);
        this.registerT2Control.setValue(0);
        return this.execute_alu_step7;
    }
    execute_alu_step7() {
        this.executeSteps += 1;
        this.description = `${this.alu_ins_name} (Step ${this.executeSteps}): Compute value and Copy Result into Register`;
        let ins = this.instructionBus.getValue();
        let ins_body = 0b111 & (ins >> 3);
        let ins_dest = 1 & ins;
        this.aluControl.setValue(ins_body);
        if (ins_dest == 0) {
            this.description += 'A';
            this.registerAControl.setValue(CTRL_SET);
        }
        else {
            this.description += 'B';
            this.registerBControl.setValue(CTRL_SET);
        }
        return this.execute_alu_step8;
    }
    execute_alu_step8() {
        this.executeSteps += 1;
        this.description = `${this.alu_ins_name} (Step ${this.executeSteps}): Clear Control`;
        this.aluControl.setValue(0);
        this.registerAControl.setValue(0);
        this.registerBControl.setValue(0);
        return this.fetch_step1;
    }
    execute_jump() {
        let ins = this.instructionBus.getValue();
        let ins_body = 0b111 & (ins >> 3);
        let ins_immediate = 1 & (ins >> 2);
        this.executeSteps += 1;
        this.jmp_ins_name = Object.keys(JMP_INSTRUCTIONS)[Object.values(JMP_INSTRUCTIONS).indexOf(ins_body)].toUpperCase();
        if (ins_immediate)
            this.jmp_ins_name += ' Immediate';
        this.description = `${this.jmp_ins_name} (Step ${this.executeSteps}): Check Flags`;
        let condition_flag = true;
        if (ins_body == INS_JMP_JEZ) {
            if (!(this.flags.getValue() & FLGS_Z)) {
                condition_flag = false;
            }
        }
        else if (ins_body == INS_JMP_JGZ) {
            if ((this.flags.getValue() & FLGS_S) || this.flags.getValue() & FLGS_Z) {
                condition_flag = false;
            }
        }
        else if (ins_body == INS_JMP_JLZ) {
            if (!(this.flags.getValue() & FLGS_S) || this.flags.getValue() & FLGS_Z) {
                condition_flag = false;
            }
        }
        this.description += ` (${condition_flag})`;
        if (condition_flag) {
            return this.execute_jump_step1;
        }
        if (ins_immediate) {
            this.programControl.setValue(CTRL_INC);
            return this.execute_jump_step4;
        }
        else {
            return this.fetch_step1;
        }
    }
    execute_jump_step1() {
        let ins = this.instructionBus.getValue();
        let ins_immediate = 1 & (ins >> 2);
        let ins_register = 1 & (ins >> 1);
        this.executeSteps += 1;
        this.description = `${this.jmp_ins_name} (Step ${this.executeSteps}): `;
        if (ins_immediate) {
            this.description += 'Copy PC into Address Register';
            this.programControl.setValue(CTRL_ENB);
            this.addressControl.setValue(CTRL_SET);
            return this.execute_jump_step2;
        }
        else {
            this.description += 'Copy Register ';
            if (ins_register == 0) {
                this.description += 'A';
                this.registerAControl.setValue(CTRL_ENB);
            }
            else {
                this.description += 'B';
                this.registerBControl.setValue(CTRL_ENB);
            }
            this.description += ' into PC';
            this.programControl.setValue(CTRL_SET);
            return this.execute_jump_step4;
        }
    }
    execute_jump_step2() {
        this.executeSteps += 1;
        this.description = `${this.jmp_ins_name} (Step ${this.executeSteps}): Clear Control and Increment PC`;
        this.programControl.setValue(CTRL_INC);
        this.addressControl.setValue(0);
        return this.execute_jump_step3;
    }
    execute_jump_step3() {
        this.executeSteps += 1;
        this.description = `${this.jmp_ins_name} (Step ${this.executeSteps}): Copy Ram into PC`;
        this.ramControl.setValue(CTRL_ENB);
        this.programControl.setValue(CTRL_SET);
        return this.execute_jump_step4;
    }
    execute_jump_step4() {
        this.executeSteps += 1;
        this.description = `${this.jmp_ins_name} (Step ${this.executeSteps}): Clear Control`;
        this.ramControl.setValue(0);
        this.registerAControl.setValue(0);
        this.registerBControl.setValue(0);
        this.programControl.setValue(0);
        return this.fetch_step1;
    }
    update() {
        this.currentInstruction = this.currentInstruction();
    }
}
function assemble_alu_ins(ins) {
    let pattern = `(${Object.keys(ALU_INSTRUCTIONS).filter(v => v != 'not').join('|')}) (?:(a|b) (a|b)|(-?\\d{1,3}) (a|b)|(a|b) (-?\\d{1,3})) (a|b)|not (-?\\d{1,3}|a|b) (a|b)`;
    let match = ins.toLowerCase().match(pattern);
    if (match == null) {
        return null;
    }
    match = match.slice(1).filter(v => v != null);
    let ins_name = match[0];
    let instruction = [0];
    let prefix = 0;
    let infix = ALU_INSTRUCTIONS[ins_name];
    let t1 = 0;
    let t2 = 0;
    let d = 0;
    let immediate_value = null;
    if (ins_name == 'not') {
        let op = match[1];
        if (op.match("-?\\d+")) {
            prefix = INS_ALU_I;
            immediate_value = parseInt(op, 10);
        }
        else {
            prefix = INS_ALU_R;
        }
        let dest = match[2];
        d = dest == 'a' ? 0 : 1;
    }
    else {
        let op1 = match[1];
        let op2 = match[2];
        if (op1.match("-?\\d+") || op2.match("-?\\d+")) {
            prefix = INS_ALU_I;
            if (op1.match("-?\\d+")) {
                immediate_value = parseInt(op1, 10);
                t1 = 0;
            }
            else {
                immediate_value = parseInt(op2, 10);
                t1 = 1;
            }
        }
        else {
            prefix = INS_ALU_R;
        }
        if (op1 == 'b' && immediate_value == null) {
            t1 = 1;
        }
        else if (op2 == 'b' && immediate_value == null) {
            t2 = 1;
        }
        else if (immediate_value != null) {
            t2 = (op1 == 'a' || op2 == 'a') ? 0 : 1;
        }
        let dest = match[3];
        d = dest == 'a' ? 0 : 1;
    }
    if (immediate_value != null) {
        instruction[1] = immediate_value & ((1 << WORD_SIZE) - 1);
    }
    instruction[0] = (prefix << 6) | (infix << 3) | (t1 << 2) | (t2 << 1) | d;
    return instruction;
}
const patternAluInstruction = `^(${Object.keys(ALU_INSTRUCTIONS).filter(v => v != 'not').join('|')}) ([abi]) ([abi]) ([ab])|(not) ([abi]) ([ab])$`;
function assembleAluInstruction(instruction) {
    let match = instruction.match(patternAluInstruction);
    if (!match) {
        return null;
    }
    match = match.filter(v => v && v.length > 0).slice(1);
    let immediate = match[1] == 'i' || match[2] == 'i';
    let prefix = immediate ? INS_ALU_I : INS_ALU_R;
    let infix = ALU_INSTRUCTIONS[match[0]];
    let t1 = match[1] == 'b' || match[2] == 'i' ? 1 : 0;
    let t2 = 0;
    let d;
    if (match[0] == 'not') {
        d = match[2] == 'b' ? 1 : 0;
    }
    else {
        t2 = match[2] == 'b' || (immediate && match[1] == 'b') ? 1 : 0;
        d = match[3] == 'b' ? 1 : 0;
    }
    let instructionValue = (prefix << 6) | (infix << 3) | (t1 << 2) | (t2 << 1) | d;
    return new RamWord(instructionValue, instruction);
}
const patternJmpInstruction = `^(${Object.keys(JMP_INSTRUCTIONS).join('|')}) ([abi])$`;
function assembleJmpInstruction(instruction) {
    let match = instruction.match(patternJmpInstruction);
    if (!match) {
        return null;
    }
    match = match.filter(v => v && v.length > 0).slice(1);
    let prefix = INS_JMP;
    let infix = JMP_INSTRUCTIONS[match[0]];
    let i = match[1] == 'i' ? 1 : 0;
    let s = match[1] == 'b' ? 1 : 0;
    let d = 0;
    let instructionValue = (prefix << 6) | (infix << 3) | (i << 2) | (s << 1) | d;
    return new RamWord(instructionValue, instruction);
}
const patternRamInstruction = /^(save) ([ab]) ([ab])|(load) ([abi]) ([ab])$/;
function assembleRamInstruction(instruction) {
    let match = instruction.match(patternRamInstruction);
    if (!match) {
        return null;
    }
    match = match.filter(v => v && v.length > 0).slice(1);
    let prefix = INS_RAM;
    let infix = RAM_INSTRUCTIONS[match[0]];
    let i = match[1] == 'i' ? 1 : 0;
    let s = match[0] == 'save' ? (match[2] == 'b' ? 1 : 0) : (match[1] == 'b' ? 1 : 0);
    let d = match[0] == 'save' ? (match[1] == 'b' ? 1 : 0) : (match[2] == 'b' ? 1 : 0);
    let instructionValue = (prefix << 6) | (infix << 3) | (i << 2) | (s << 1) | d;
    return new RamWord(instructionValue, instruction);
}
const patternDecNumber = `-?\\d{1,3}`;
const patternHexNumber = `0x[\\da-f]{1,2}`;
const patternBinNumber = `0b[01]{1,8}`;
const patternNumber = `(?:^|\\s)(${patternHexNumber}|${patternBinNumber}|${patternDecNumber})(?:\\s|$)`;
function assembleInstruction(instruction) {
    instruction = instruction.toLowerCase();
    let regExpNumber = new RegExp(patternNumber);
    let match = regExpNumber.exec(instruction);
    let immediateText = null;
    let immediateNumber = null;
    if (match) {
        if (match.length > 2) {
            console.warn("Too many immediate values detected.");
        }
        immediateText = match[1];
        instruction = instruction.replace(immediateText, 'i');
        if (immediateText.match(`^${patternDecNumber}$`)) {
            immediateNumber = new RamWord(parseInt(immediateText, 10));
            immediateNumber.displayMode = 0;
        }
        else if (immediateText.match(`^${patternHexNumber}$`)) {
            immediateNumber = new RamWord(parseInt(immediateText.replace('0x', ''), 16));
            immediateNumber.displayMode = 1;
        }
        else { // if (immediateText.match(`^${patternBinNumber}$`)) {
            immediateNumber = new RamWord(parseInt(immediateText.replace('0b', ''), 2));
            immediateNumber.displayMode = 2;
        }
    }
    let instructionWord = assembleAluInstruction(instruction);
    if (instructionWord == null) {
        instructionWord = assembleJmpInstruction(instruction);
        if (instructionWord == null) {
            instructionWord = assembleRamInstruction(instruction);
        }
    }
    if (instructionWord == null) {
        if (immediateNumber != null && instruction == 'i') {
            return [immediateNumber];
        }
        console.warn("Unable to compile instruction. Check syntax.");
    }
    if (immediateNumber != null) {
        return [instructionWord, immediateNumber];
    }
    return [instructionWord];
}
//# sourceMappingURL=proc_sim.js.map