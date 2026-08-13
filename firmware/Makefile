# DrainPulse Edge Firmware - ASR6601 / STM32WLE5 scaffold
# Adjust the toolchain and linker script paths for your actual target board.

PROJECT      := drainpulse-edge
BUILD_DIR    := build
SRC_DIR      := src

CXX          := arm-none-eabi-g++
CC           := arm-none-eabi-gcc
OBJCOPY      := arm-none-eabi-objcopy
SIZE         := arm-none-eabi-size

# Target is an ASR6601 (Cortex-M0+, similar to STM32WLE5)
CPU_FLAGS    := -mcpu=cortex-m0plus -mthumb
OPT          := -O2 -g
WARNINGS     := -Wall -Wextra
CXX_STD      := -std=c++17

# Placeholder linker script; replace with the real ASR6601/STM32WLE5 script.
LDSCRIPT     := $(SRC_DIR)/asr6601.ld

CXXFLAGS     := $(CPU_FLAGS) $(OPT) $(WARNINGS) $(CXX_STD) -I$(SRC_DIR)
LDFLAGS      := $(CPU_FLAGS) -T$(LDSCRIPT) -specs=nosys.specs -specs=nano.specs -Wl,--gc-sections

SRCS         := $(wildcard $(SRC_DIR)/*.cpp)
OBJS         := $(patsubst $(SRC_DIR)/%.cpp,$(BUILD_DIR)/%.o,$(SRCS))

TARGET       := $(BUILD_DIR)/$(PROJECT).elf
BIN          := $(BUILD_DIR)/$(PROJECT).bin
HEX          := $(BUILD_DIR)/$(PROJECT).hex

.PHONY: all clean size

all: $(TARGET) $(BIN) $(HEX)
	@echo "Built $(TARGET)"

$(TARGET): $(OBJS) $(LDSCRIPT)
	@mkdir -p $(BUILD_DIR)
	$(CXX) $(OBJS) $(LDFLAGS) -o $@

$(BIN): $(TARGET)
	$(OBJCOPY) -O binary $< $@

$(HEX): $(TARGET)
	$(OBJCOPY) -O ihex $< $@

$(BUILD_DIR)/%.o: $(SRC_DIR)/%.cpp
	@mkdir -p $(BUILD_DIR)
	$(CXX) $(CXXFLAGS) -c $< -o $@

clean:
	rm -rf $(BUILD_DIR)

size: $(TARGET)
	$(SIZE) $(TARGET)
